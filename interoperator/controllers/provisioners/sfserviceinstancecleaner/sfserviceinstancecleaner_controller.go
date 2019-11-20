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

package controllers

import (
	"context"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/util/retry"
)

// SfServiceInstanceCleanerReconciler reconciles a SfServiceInstanceCleaner object
type SfServiceInstanceCleanerReconciler struct {
	client.Client
	Log    logr.Logger
	Scheme *runtime.Scheme
}

func (r *SfServiceInstanceCleanerReconciler) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("sfserviceinstancecleaner", req.NamespacedName)
	binding := &osbv1alpha1.SFServiceBinding{}
	err := r.Get(ctx, req.NamespacedName, binding)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return. Created objects are automatically
			// garbage collected.
			log.Info("binding deleted", "binding", req.NamespacedName.Name)
			return ctrl.Result{}, nil
		}
		// TODO: retry when unable to read binding?
	}
	if !binding.GetDeletionTimestamp().IsZero() {
		finalizers := binding.GetFinalizers()
		if utils.ContainsString(finalizers, constants.BrokerFinalizer) {
			instance := &osbv1alpha1.SFServiceInstance{}
			namespacedName := types.NamespacedName{
				Name:      binding.Spec.InstanceID,
				Namespace: binding.GetNamespace(),
			}
			err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
				err := r.Get(ctx, namespacedName, instance)
				if err != nil && apiErrors.IsNotFound(err) {
					binding.SetFinalizers(utils.RemoveString(binding.GetFinalizers(), constants.BrokerFinalizer))
					return c.Update(context.TODO(), binding)
				}
				return err
			})
			if err != nil {
				return ctrl.Result{}, err
			}
		}
	}
	return ctrl.Result{}, nil
}

func (r *SfServiceInstanceCleanerReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&osbv1alpha1.SFServiceBinding{}).
		Complete(r)
}
