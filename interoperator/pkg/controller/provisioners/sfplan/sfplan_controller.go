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

package sfplan

import (
	"context"
	"fmt"
	"os"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var log = logf.Log.WithName("plan.controller")

// Add creates a new SFPlan Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
func Add(mgr manager.Manager) error {
	return add(mgr, newReconciler(mgr))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager) reconcile.Reconciler {
	initWatches := make(chan struct{}, 100)
	stopWatches := make(chan struct{})
	go restartOnWatchUpdate(mgr, initWatches, stopWatches)
	return &ReconcileSfPlan{
		Client:      mgr.GetClient(),
		scheme:      mgr.GetScheme(),
		initWatches: initWatches,
		stopWatches: stopWatches,
	}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	// Create a new controller
	c, err := controller.New("sfplan-controller", mgr, controller.Options{Reconciler: r})
	if err != nil {
		return err
	}

	// Watch for changes to SFPlan
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.SFPlan{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}
	return nil
}

func restartOnWatchUpdate(mgr manager.Manager, initWatches, stop <-chan struct{}) {
	for {
		select {
		case <-initWatches:
			drainTimeout := time.After(constants.PlanWatchDrainTimeout)
		DrainLoop:
			for {
				select {
				case <-initWatches:
					// NOP
					// Since the InitWatchConfig performs the same computation
					// regardless of which plan has changed, drain all the
					// events occuring in a 2 second window and call
					// InitWatchConfig only once. This significantly improves
					// startup and watch refreshes.
				case <-drainTimeout:
					break DrainLoop
				}
			}
			toUpdate, err := watches.InitWatchConfig(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
			if err != nil {
				log.Error(err, "unable initializing interoperator watch list")
			}
			if toUpdate {
				log.Info("Watch list changed. Restarting interoperator")
				os.Exit(1)
			}
		case <-stop:
			// We are done
			return
		}
	}
}

var _ reconcile.Reconciler = &ReconcileSfPlan{}

// ReconcileSfPlan reconciles a SFPlan object
type ReconcileSfPlan struct {
	client.Client
	scheme      *runtime.Scheme
	initWatches chan struct{}
	stopWatches chan struct{}
}

// Reconcile reads that state of the cluster for a SFPlan object and makes changes based on the state read
// and what is in the SFPlan.Spec
// Automatically generate RBAC rules to allow the Controller to read and write Deployments
func (r *ReconcileSfPlan) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Recompute watches
	defer func() {
		r.initWatches <- struct{}{}
	}()
	// Fetch the SFPlan instance
	instance := &osbv1alpha1.SFPlan{}
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
	if labels == nil {
		labels = make(map[string]string)
	}
	updateRequired := false
	if serviceID, ok := labels["serviceId"]; !ok || instance.Spec.ServiceID != serviceID {
		labels["serviceId"] = instance.Spec.ServiceID
		updateRequired = true
	}
	if planID, ok := labels["planId"]; !ok || instance.Spec.ID != planID {
		labels["planId"] = instance.Spec.ID
		updateRequired = true
	}

	serviceID := instance.Spec.ServiceID
	services := &osbv1alpha1.SFServiceList{}
	searchLabels := make(map[string]string)
	searchLabels["serviceId"] = serviceID
	options := kubernetes.MatchingLabels(searchLabels)
	options.Namespace = request.Namespace

	err = r.List(context.TODO(), options, services)
	if err != nil {
		return reconcile.Result{}, err
	}
	var service *osbv1alpha1.SFService
	for _, obj := range services.Items {
		if obj.Spec.ID == serviceID {
			service = &obj
		}
	}
	if service == nil {
		return reconcile.Result{}, fmt.Errorf("unable to find service with id %s", serviceID)
	}

	ownerRefs := instance.GetOwnerReferences()
	existingRefs := make([]metav1.OwnerReference, len(ownerRefs))
	for i := range ownerRefs {
		existingRefs[i] = *ownerRefs[i].DeepCopy()
	}

	err = controllerutil.SetControllerReference(service, instance, r.scheme)
	if err != nil {
		return reconcile.Result{}, err
	}

	if !updateRequired {
		ownerRefs = instance.GetOwnerReferences()
		if len(ownerRefs) != len(existingRefs) {
			updateRequired = true
		} else {
			for i := range ownerRefs {
				if !referSameObject(ownerRefs[i], existingRefs[i]) {
					updateRequired = true
					break
				}
			}
		}
	}

	if updateRequired {
		instance.SetLabels(labels)
		err = r.Update(context.TODO(), instance)
		if err != nil {
			return reconcile.Result{}, err
		}
		log.Info("Plan labels updated", "plan", instance.GetName())
	}
	return reconcile.Result{}, nil
}

// Returns true if a and b point to the same object
func referSameObject(a, b metav1.OwnerReference) bool {
	aGV, err := schema.ParseGroupVersion(a.APIVersion)
	if err != nil {
		return false
	}

	bGV, err := schema.ParseGroupVersion(b.APIVersion)
	if err != nil {
		return false
	}

	return aGV == bGV && a.Kind == b.Kind && a.Name == b.Name
}
