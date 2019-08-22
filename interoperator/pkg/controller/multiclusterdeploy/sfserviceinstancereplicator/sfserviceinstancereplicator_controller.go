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

package sfserviceinstancereplicator

import (
	"context"
	"reflect"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/prometheus/common/log"

	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

/**
* USER ACTION REQUIRED: This is a scaffold file intended for the user to modify with their own Controller
* business logic.  Delete these comments after modifying this file.*
 */

// Add creates a new SFServiceInstanceReplicator Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
func Add(mgr manager.Manager) error {
	clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	return add(mgr, newReconciler(mgr, clusterRegistry))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager, clusterRegistry registry.ClusterRegistry) reconcile.Reconciler {
	return &ReconcileSFServiceInstanceReplicator{
		Client:          mgr.GetClient(),
		scheme:          mgr.GetScheme(),
		clusterRegistry: clusterRegistry,
	}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	// Create a new controller
	c, err := controller.New("sfserviceinstancereplicator-controller", mgr, controller.Options{Reconciler: r})
	if err != nil {
		return err
	}

	// Watch for changes to SFServiceInstanceReplicator
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.SFServiceInstance{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileSFServiceInstanceReplicator{}

// ReconcileSFServiceInstanceReplicator reconciles a SFServiceInstanceReplicator object
type ReconcileSFServiceInstanceReplicator struct {
	client.Client
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile reads that state of the cluster for a SFServiceInstanceReplicator object and makes changes based on the state read
// and what is in the SFServiceInstanceReplicator.Spec
// TODO(user): Modify this Reconcile function to implement your Controller logic.  The scaffolding writes
// a Deployment as an example
// +kubebuilder:rbac:groups=osb.servicefabrik.io,resources=*,verbs=*
func (r *ReconcileSFServiceInstanceReplicator) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the SFServiceInstanceReplicator instance
	instance := &osbv1alpha1.SFServiceInstance{}
	replica := &osbv1alpha1.SFServiceInstance{}
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

	instanceID := instance.GetName()
	clusterID, err := instance.GetClusterID()
	if err != nil {
		log.Info("clusterID not set. Ignoring", "instance", instanceID)
		return reconcile.Result{}, nil
	}

	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		return reconcile.Result{}, err
	}

	err = targetClient.Get(context.TODO(), request.NamespacedName, replica)
	if err != nil {
		if !errors.IsNotFound(err) {
			log.Info("creating SFServiceInstance in target cluster", "instance", instanceID,
				"clusterID", clusterID)
			replica.SetName(instance.GetName())
			replica.SetNamespace(instance.GetNamespace())
			replica.SetLabels(instance.GetLabels())
			replica.SetAnnotations(instance.GetAnnotations())
			instance.Spec.DeepCopyInto(&replica.Spec)

			err = targetClient.Create(context.TODO(), replica)
			if err != nil {
				log.Error(err, "Error during creation of SFServiceInstance in target cluster", "instance", instanceID,
					"clusterID", clusterID)
				return reconcile.Result{}, err
			}
			log.Info("Created SFServiceInstance in target cluster", "instance", instanceID,
				"clusterID", clusterID)
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return reconcile.Result{}, err
	}

	// object already existed, so we update it
	if !reflect.DeepEqual(instance.Spec, replica.Spec) {
		instance.Spec.DeepCopyInto(&replica.Spec)
		err = targetClient.Update(context.TODO(), replica)
		if err != nil {
			log.Error(err, "Error during updating of SFServiceInstance in target cluster", "instance", instanceID,
				"clusterID", clusterID)
			return reconcile.Result{}, err
		}
		log.Info("Updated SFServiceInstance in target cluster", "instance", instanceID,
			"clusterID", clusterID)
	}

	return reconcile.Result{}, nil
}
