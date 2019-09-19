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

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/controller/multiclusterdeploy/watchmanager"

	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var log = logf.Log.WithName("instance.replicator")

// To the function mock
var getWatchChannel = watchmanager.GetWatchChannel

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

	// Watch for changes to SFServiceInstance
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.SFServiceInstance{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	// Init watch manager
	err = watchmanager.Initialize(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}

	// Watch for changes to SFServiceInstance in sister clusters
	watchEvents, err := getWatchChannel("sfserviceinstances")
	if err != nil {
		return err
	}
	err = c.Watch(&source.Channel{Source: watchEvents}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileSFServiceInstanceReplicator{}

// ReconcileSFServiceInstanceReplicator replicates a SFServiceInstance object to sister cluster
type ReconcileSFServiceInstanceReplicator struct {
	client.Client
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile reads that state of the cluster for a SFServiceInstance object on master and sister cluster
// and replicates it.
func (r *ReconcileSFServiceInstanceReplicator) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the SFServiceInstanceReplicator instance
	instance := &osbv1alpha1.SFServiceInstance{}
	replica := &osbv1alpha1.SFServiceInstance{}
	err := r.Get(context.TODO(), request.NamespacedName, instance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return reconcile.Result{}, err
	}

	instanceID := instance.GetName()
	state := instance.GetState()
	clusterID, err := instance.GetClusterID()
	if err != nil {
		log.Info("clusterID not set. Ignoring", "instance", instanceID)
		return reconcile.Result{}, nil
	}

	if clusterID == constants.DefaultMasterClusterID {
		// Target cluster is mastercluster itself
		// Replication not needed
		return reconcile.Result{}, nil
	}

	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		return reconcile.Result{}, err
	}

	// Trigger delete for namespace in target cluster if deletion time stamp is set for instance
	err = r.reconcileNamespace(targetClient, instance.GetNamespace(), clusterID,
		!instance.GetDeletionTimestamp().IsZero())
	if err != nil {
		return reconcile.Result{}, err
	}

	if !instance.GetDeletionTimestamp().IsZero() && state == "delete" {
		replica.SetName(instance.GetName())
		replica.SetNamespace(instance.GetNamespace())
		err := targetClient.Delete(context.TODO(), replica)
		if err != nil {
			if !apiErrors.IsNotFound(err) {
				log.Error(err, "Failed to delete SFServiceInstance from target cluster", "instance", instanceID,
					"clusterID", clusterID, "state", state)
				return reconcile.Result{}, err
			}
		}
	}

	log.Info("SFServiceInstance from target cluster", "instance", instanceID,
		"clusterID", clusterID, "state", state)
	if state == "in_queue" || state == "update" || state == "delete" {
		err = targetClient.Get(context.TODO(), request.NamespacedName, replica)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				copyObject(instance, replica)
				err = targetClient.Create(context.TODO(), replica)
				if err != nil {
					log.Error(err, "Error occurred while replicating SFServiceInstance to cluster ",
						"clusterID", clusterID, "instanceID", instanceID, "state", state)
					return reconcile.Result{}, err
				}
			} else {
				log.Error(err, "Failed to fetch SFServiceInstance from target cluster", "instance", instanceID,
					"clusterID", clusterID, "state", state)
				// Error reading the object - requeue the request.
				return reconcile.Result{}, err
			}
		} else {
			copyObject(instance, replica)
			err = targetClient.Update(context.TODO(), replica)
			if err != nil {
				log.Error(err, "Error occurred while replicating SFServiceInstance to cluster ",
					"clusterID", clusterID, "instanceID", instanceID, "state", state)
				return reconcile.Result{}, err
			}
		}

		err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
			return r.setInProgress(instance)
		})
		if err != nil {
			return reconcile.Result{}, err
		}
	}

	state = instance.GetState()
	labels := instance.GetLabels()
	lastOperation, ok := labels[constants.LastOperationKey]
	if !ok {
		lastOperation = "in_queue"
	}

	if state == "in progress" {
		err = targetClient.Get(context.TODO(), request.NamespacedName, replica)
		if err != nil {
			log.Error(err, "Failed to fetch SFServiceInstance from target cluster", "instance", instanceID,
				"clusterID", clusterID, "state", state)
			if apiErrors.IsNotFound(err) && lastOperation == "delete" {
				instance.SetState("succeeded")
			} else {
				log.Error(err, "Failed to fetch SFServiceInstance from target cluster", "instance", instanceID,
					"clusterID", clusterID, "state", state)
				// Error reading the object - requeue the request.
				return reconcile.Result{}, err
			}
		} else {
			replicaState := replica.GetState()
			if replicaState == "in_queue" || replicaState == "update" || replicaState == "delete" {
				// replica not processed up by provisioner in target cluster
				// ignore for now
				return reconcile.Result{}, nil
			}
			copyObject(replica, instance)
		}

		err = r.Update(context.TODO(), instance)
		if err != nil {
			log.Error(err, "Failed to update SFServiceInstance in master cluster", "instance", instanceID,
				"clusterID", clusterID, "state", state)
			// Error updating the object - requeue the request.
			return reconcile.Result{}, err
		}
	}

	return reconcile.Result{}, nil
}

func (r *ReconcileSFServiceInstanceReplicator) reconcileNamespace(targetClient client.Client, namespace, clusterID string, delete bool) error {
	ns := &corev1.Namespace{}

	err := targetClient.Get(context.TODO(), types.NamespacedName{
		Name: namespace,
	}, ns)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			if delete {
				return nil
			}
			log.Info("creating namespace in target cluster", "clusterID", clusterID,
				"namespace", namespace)
			ns.SetName(namespace)
			err = targetClient.Create(context.TODO(), ns)
			if err != nil {
				log.Error(err, "Failed to create namespace in target cluster", "namespace", namespace,
					"clusterID", clusterID)
				// Error updating the object - requeue the request.
				return err
			}
			log.Info("Created namespace in target cluster", "namespace", namespace,
				"clusterID", clusterID)
			return nil
		}
		log.Error(err, "Failed to fetch namespace from target cluster", "namespace", namespace,
			"clusterID", clusterID)
		return err

	}
	if delete {
		err = targetClient.Delete(context.TODO(), ns)
		if err != nil {
			if apiErrors.IsConflict(err) || apiErrors.IsNotFound(err) {
				// delete triggered
				return nil
			}
			log.Error(err, "Failed to delete namespace from target cluster", "namespace", namespace,
				"clusterID", clusterID)

			return err
		}
	}

	return nil
}

func (r *ReconcileSFServiceInstanceReplicator) setInProgress(instance *osbv1alpha1.SFServiceInstance) error {
	instanceID := instance.GetName()
	state := instance.GetState()
	err := r.Get(context.TODO(), types.NamespacedName{
		Name:      instanceID,
		Namespace: instance.GetNamespace(),
	}, instance)
	if err != nil {
		log.Error(err, "Failed to fetch sfserviceinstance for setInProgress", "operation", state,
			"instanceId", instanceID)
		return err
	}

	state = instance.GetState()
	instance.SetState("in progress")
	labels := instance.GetLabels()
	if labels == nil {
		labels = make(map[string]string)
	}
	labels[constants.LastOperationKey] = state
	instance.SetLabels(labels)
	err = r.Update(context.TODO(), instance)
	if err != nil {
		log.Error(err, "Updating status to in progress failed", "operation", state, "instanceId", instanceID)
		return err
	}
	log.Info("Updated status to in progress", "operation", state, "instanceId", instanceID)
	return nil
}

func copyObject(source, destination *osbv1alpha1.SFServiceInstance) {
	destination.SetName(source.GetName())
	destination.SetNamespace(source.GetNamespace())
	destination.SetLabels(source.GetLabels())
	destination.SetAnnotations(source.GetAnnotations())
	source.Spec.DeepCopyInto(&destination.Spec)
	source.Status.DeepCopyInto(&destination.Status)
}
