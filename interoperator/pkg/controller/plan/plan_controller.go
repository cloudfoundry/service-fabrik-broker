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

package plan

import (
	"context"
	"log"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

// Add creates a new Plan Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
func Add(mgr manager.Manager) error {
	return add(mgr, newReconciler(mgr))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager) reconcile.Reconciler {
	return &ReconcilePlan{Client: mgr.GetClient(), scheme: mgr.GetScheme()}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	// Create a new controller
	c, err := controller.New("plan-controller", mgr, controller.Options{Reconciler: r})
	if err != nil {
		return err
	}

	// Watch for changes to Plan
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.Plan{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}
	return nil
}

var _ reconcile.Reconciler = &ReconcilePlan{}

// ReconcilePlan reconciles a Plan object
type ReconcilePlan struct {
	client.Client
	scheme *runtime.Scheme
}

// Reconcile reads that state of the cluster for a Plan object and makes changes based on the state read
// and what is in the Plan.Spec
// +kubebuilder:rbac:groups=osb.servicefabrik.io,resources=plans,verbs=get;list;watch;create;update;patch;delete
func (r *ReconcilePlan) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the Plan instance
	instance := &osbv1alpha1.Plan{}
	err := r.Get(context.TODO(), request.NamespacedName, instance)
	if err != nil {
		if errors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return reconcile.Result{}, err
	}
	labels := instance.GetLabels()
	updateRequired := false
	if serviceID, ok := labels["serviceId"]; !ok || instance.Spec.ServiceID != serviceID {
		labels["serviceId"] = instance.Spec.ServiceID
		updateRequired = true
	}
	if planID, ok := labels["planId"]; !ok || instance.Spec.ID != planID {
		labels["planId"] = instance.Spec.ID
		updateRequired = true
	}

	if updateRequired {
		instance.SetLabels(labels)
		err = r.Update(context.TODO(), instance)
		if err != nil {
			return reconcile.Result{}, err
		}
		log.Printf("Plan %s labels updated\n", instance.GetName())
	}
	return reconcile.Result{}, nil
}
