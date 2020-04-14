/*
Copyright 2019 The Service Fabrik Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package sfservicebindingcleaner

import (
	"context"
	"encoding/json"

	"github.com/go-logr/logr"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
)

// ReconcileSFServiceBindingCleaner reconciles a SfServiceBindingCleaner object
type ReconcileSFServiceBindingCleaner struct {
	client.Client
	Log    logr.Logger
	Scheme *runtime.Scheme
}

func (r *ReconcileSFServiceBindingCleaner) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("sfservicebindingcleaner", req.NamespacedName)
	binding := &osbv1alpha1.SFServiceBinding{}
	err := r.Get(ctx, req.NamespacedName, binding)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return. Created objects are automatically
			// garbage collected. For additional cleanup logic use finalizers.
			log.Info("binding deleted", "binding", req.NamespacedName.Name)
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err // error reading object, requeue the request
	}
	if !binding.GetDeletionTimestamp().IsZero() {
		instance := &osbv1alpha1.SFServiceInstance{}
		namespacedName := types.NamespacedName{
			Name:      binding.Spec.InstanceID,
			Namespace: binding.GetNamespace(),
		}
		err = r.Get(ctx, namespacedName, instance)
		if err != nil && apiErrors.IsNotFound(err) {
			mergePatch, err := json.Marshal(map[string]interface{}{
				"metadata": map[string]interface{}{
					"finalizers": []string{},
				},
			})
			if err != nil {
				log.Error(err, "Error occurred while constructing JSON merge patch")
				return ctrl.Result{}, err
			}
			err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
				binding.SetFinalizers([]string{})
				err = r.Patch(context.TODO(), binding, client.ConstantPatch(types.MergePatchType, mergePatch))
				if err != nil {
					// The binding is possibly outdated, fetch it again and
					// retry the patch operation.
					_ = r.Get(ctx, req.NamespacedName, binding)
					return err
				}
				return nil
			})
			if err != nil {
				log.Error(err, "Error occurred while updating finalizers on binding")
			}
		}
	}
	return ctrl.Result{}, nil
}

func (r *ReconcileSFServiceBindingCleaner) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&osbv1alpha1.SFServiceBinding{}).
		Complete(r)
}
