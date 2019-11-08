/*
Copyright 2018 The Service Fabrik Authors.

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

package sfservice

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// ReconcileSFService reconciles a SFService object
type ReconcileSFService struct {
	client.Client
	Log    logr.Logger
	scheme *runtime.Scheme
}

// Reconcile reads that state of the cluster for a SFService object and makes changes based on the state read
// and what is in the SFService.Spec
// Automatically generate RBAC rules to allow the Controller to read and write Deployments
func (r *ReconcileSFService) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("sfservice", req.NamespacedName)

	// Fetch the SFService instance
	instance := &osbv1alpha1.SFService{}
	err := r.Get(ctx, req.NamespacedName, instance)
	if err != nil {
		if errors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	labels := instance.GetLabels()
	if labels == nil {
		labels = make(map[string]string)
	}
	if serviceID, ok := labels["serviceId"]; !ok || instance.Spec.ID != serviceID {
		labels["serviceId"] = instance.Spec.ID
		instance.SetLabels(labels)
		err = r.Update(ctx, instance)
		if err != nil {
			return ctrl.Result{}, err
		}
		log.Info("Service labels updated")
	}
	return ctrl.Result{}, nil
}

// SetupWithManager registers the SFService Controller with manager
// and setups the watches.
func (r *ReconcileSFService) SetupWithManager(mgr ctrl.Manager) error {
	r.scheme = mgr.GetScheme()

	return ctrl.NewControllerManagedBy(mgr).
		Named("service").
		For(&osbv1alpha1.SFService{}).
		Complete(r)
}
