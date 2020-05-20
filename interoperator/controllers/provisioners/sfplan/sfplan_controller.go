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

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
)

func restartOnWatchUpdate(mgr manager.Manager, initWatches, stop <-chan struct{}) {
	log := ctrl.Log.WithName("provisioners").WithName("sfplan")
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
				log.V(0).Info("Watch list changed. Restarting interoperator")
				os.Exit(1)
			}
		case <-stop:
			// We are done
			return
		}
	}
}

// ReconcileSFPlan reconciles a SFPlan object
type ReconcileSFPlan struct {
	client.Client
	Log         logr.Logger
	scheme      *runtime.Scheme
	initWatches chan struct{}
	stopWatches chan struct{}
}

// Reconcile reads that state of the cluster for a SFPlan object and makes changes based on the state read
// and what is in the SFPlan.Spec
// Automatically generate RBAC rules to allow the Controller to read and write Deployments
func (r *ReconcileSFPlan) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	// Recompute watches
	defer func() {
		r.initWatches <- struct{}{}
	}()

	ctx := context.Background()
	log := r.Log.WithValues("sfplan", req.NamespacedName)

	// Fetch the SFPlan instance
	instance := &osbv1alpha1.SFPlan{}
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
	options := &client.ListOptions{
		Namespace: req.Namespace,
	}
	searchLabels := make(client.MatchingLabels)
	searchLabels["serviceId"] = serviceID
	searchLabels.ApplyToList(options)

	err = r.List(ctx, services, options)
	if err != nil {
		return ctrl.Result{}, err
	}
	var service *osbv1alpha1.SFService
	for _, obj := range services.Items {
		if obj.Spec.ID == serviceID {
			service = &obj
		}
	}
	if service == nil {
		return ctrl.Result{}, fmt.Errorf("unable to find service with id %s", serviceID)
	}

	ownerRefs := instance.GetOwnerReferences()
	existingRefs := make([]metav1.OwnerReference, len(ownerRefs))
	for i := range ownerRefs {
		existingRefs[i] = *ownerRefs[i].DeepCopy()
	}

	err = utils.SetOwnerReference(service, instance, r.scheme)
	if err != nil {
		return ctrl.Result{}, err
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
		err = r.Update(ctx, instance)
		if err != nil {
			return ctrl.Result{}, err
		}
		log.Info("Plan labels updated", "plan", instance.GetName())
	}
	return ctrl.Result{}, nil
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

// SetupWithManager registers the SFPlan Controller with manager
// and setups the watches.
func (r *ReconcileSFPlan) SetupWithManager(mgr ctrl.Manager) error {
	r.scheme = mgr.GetScheme()
	initWatches := make(chan struct{}, 100)
	stopWatches := make(chan struct{})
	go restartOnWatchUpdate(mgr, initWatches, stopWatches)
	r.initWatches = initWatches
	r.stopWatches = stopWatches

	return ctrl.NewControllerManagedBy(mgr).
		Named("plan").
		For(&osbv1alpha1.SFPlan{}).
		WithEventFilter(watches.NamespaceFilter()).
		Complete(r)
}
