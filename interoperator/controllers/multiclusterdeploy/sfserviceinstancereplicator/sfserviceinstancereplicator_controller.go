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

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/watchmanager"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	"github.com/prometheus/client_golang/prometheus"
	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/metrics"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var (
	instancesMetric = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name:      "state",
			Namespace: "interoperator",
			Subsystem: "service_instances",
			Help:      "State of service instance. 0 - succeeded, 1 - failed, 2 - in progress, 3 - in_queue/update/delete, 4 - gone",
		},
		[]string{
			// What was the state of the instance
			"instance_id",
		},
	)
)

// To the function mock
var getWatchChannel = watchmanager.GetWatchChannel

// InstanceReplicator replicates a SFServiceInstance object to sister cluster
type InstanceReplicator struct {
	client.Client
	Log             logr.Logger
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile reads that state of the cluster for a SFServiceInstance object on master and sister cluster
// and replicates it.
func (r *InstanceReplicator) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("instance", req.NamespacedName)

	// Fetch the SFServiceInstanceReplicator instance
	instance := &osbv1alpha1.SFServiceInstance{}
	replica := &osbv1alpha1.SFServiceInstance{}
	err := r.Get(ctx, req.NamespacedName, instance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.
			instancesMetric.WithLabelValues(req.NamespacedName.Name).Set(4)
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	instanceID := instance.GetName()
	state := instance.GetState()
	switch state {
	case "succeeded":
		instancesMetric.WithLabelValues(instanceID).Set(0)
	case "failed":
		instancesMetric.WithLabelValues(instanceID).Set(1)
	case "in progress":
		instancesMetric.WithLabelValues(instanceID).Set(2)
	case "in_queue":
	case "update":
	case "delete":
		instancesMetric.WithLabelValues(instanceID).Set(3)
	}

	clusterID, err := instance.GetClusterID()
	if err != nil {
		log.Info("clusterID not set. Ignoring", "instance", instanceID)
		return ctrl.Result{}, nil
	}

	if clusterID == constants.OwnClusterID {
		// Target cluster is mastercluster itself
		// Replication not needed
		return ctrl.Result{}, nil
	}

	labels := instance.GetLabels()
	if labels == nil {
		labels = make(map[string]string)
	}
	lastOperation, ok := labels[constants.LastOperationKey]
	if !ok {
		lastOperation = "in_queue"
	}

	log = log.WithValues("instance", instanceID, "clusterID", clusterID)

	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		return ctrl.Result{}, err
	}

	// Trigger delete for namespace in target cluster if deletion time stamp is set for instance
	err = r.reconcileNamespace(targetClient, instance.GetNamespace(), clusterID,
		!instance.GetDeletionTimestamp().IsZero())
	if err != nil {
		return ctrl.Result{}, err
	}

	if !instance.GetDeletionTimestamp().IsZero() && state == "delete" {
		replica.SetName(instance.GetName())
		replica.SetNamespace(instance.GetNamespace())
		err := targetClient.Delete(ctx, replica)
		if err != nil {
			if !apiErrors.IsNotFound(err) {
				log.Error(err, "Failed to delete SFServiceInstance from target cluster", "state", state, "lastOperation", lastOperation)
				return ctrl.Result{}, err
			}
		}
		log.Info("Triggered delete of sfserviceinstance from target cluster", "state", state, "lastOperation", lastOperation)
	}

	if state == "in_queue" || state == "update" || state == "delete" {
		err = targetClient.Get(ctx, req.NamespacedName, replica)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				copyObject(instance, replica)
				err = targetClient.Create(ctx, replica)
				if err != nil {
					log.Error(err, "Error occurred while replicating SFServiceInstance to cluster ",
						"state", state, "lastOperation", lastOperation)
					return ctrl.Result{}, err
				}
				log.Info("sfserviceinstance not found in target cluster. created as copy from master", "state", state, "lastOperation", lastOperation)
			} else {
				log.Error(err, "Failed to fetch SFServiceInstance from target cluster", "state", state, "lastOperation", lastOperation)
				// Error reading the object - requeue the request.
				return ctrl.Result{}, err
			}
		} else {
			copyObject(instance, replica)
			err = targetClient.Update(ctx, replica)
			if err != nil {
				log.Error(err, "Error occurred while replicating SFServiceInstance to cluster ",
					"state", state, "lastOperation", lastOperation)
				return ctrl.Result{}, err
			}
			log.Info("updated sfserviceinstance in target cluster", "state", state, "lastOperation", lastOperation)
		}

		err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
			return r.setInProgress(instance)
		})
		if err != nil {
			return ctrl.Result{}, err
		}
	}

	state = instance.GetState()
	labels = instance.GetLabels()
	lastOperation, ok = labels[constants.LastOperationKey]
	if !ok {
		lastOperation = "in_queue"
	}

	if state == "in progress" {
		var (
			replicaState         string
			replicaLabels        map[string]string
			replicaLastOperation string
		)

		err = targetClient.Get(ctx, req.NamespacedName, replica)
		if err != nil {
			if apiErrors.IsNotFound(err) && lastOperation == "delete" {
				log.Info("Failed to fetch SFServiceInstance from target cluster. Setting state as succeeded",
					"state", state, "lastOperation", lastOperation)
				instance.SetState("succeeded")
			} else {
				log.Error(err, "Failed to fetch SFServiceInstance from target cluster",
					"state", state, "lastOperation", lastOperation)
				// Error reading the object - requeue the request.
				return ctrl.Result{}, err
			}
		} else {
			replicaState = replica.GetState()
			replicaLabels = replica.GetLabels()
			if replicaLabels == nil {
				replicaLabels = make(map[string]string)
			}
			replicaLastOperation, ok = replicaLabels[constants.LastOperationKey]
			if !ok {
				replicaLastOperation = "in_queue"
			}
			if replicaState == "in_queue" || replicaState == "update" || replicaState == "delete" {
				// replica not processed up by provisioner in target cluster
				// ignore for now
				log.Info("replica not yet processed in target cluster", "state", state, "lastOperation", lastOperation,
					"replicaState", replicaState, "replicaLastOperation", replicaLastOperation)
				return ctrl.Result{}, nil
			}
			copyObject(replica, instance)
			log.Info("copying sfserviceinstance from target cluster to master", "state", state, "lastOperation", lastOperation,
				"replicaState", replicaState, "replicaLastOperation", replicaLastOperation)
		}

		err = r.Update(ctx, instance)
		if err != nil {
			log.Error(err, "Failed to update SFServiceInstance in master cluster", "state", state, "lastOperation", lastOperation,
				"replicaState", replicaState, "replicaLastOperation", replicaLastOperation)
			// Error updating the object - requeue the request.
			return ctrl.Result{}, err
		}
		log.Info("Updated sfserviceinstance in master", "state", state, "lastOperation", lastOperation,
			"replicaState", replicaState, "replicaLastOperation", replicaLastOperation)
	}

	return ctrl.Result{}, nil
}

func (r *InstanceReplicator) reconcileNamespace(targetClient client.Client, namespace, clusterID string, delete bool) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", clusterID, "namespace", namespace, "deleteNamespace", delete)

	ns := &corev1.Namespace{}

	err := targetClient.Get(ctx, types.NamespacedName{
		Name: namespace,
	}, ns)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			if delete {
				log.Info("namespace already deleted in target cluster")
				return nil
			}
			log.Info("creating namespace in target cluster")
			ns.SetName(namespace)
			err = targetClient.Create(ctx, ns)
			if err != nil {
				log.Error(err, "Failed to create namespace in target cluster")
				// Error updating the object - requeue the request.
				return err
			}
			log.Info("Created namespace in target cluster")
			return nil
		}
		log.Error(err, "Failed to fetch namespace from target cluster")
		return err

	}
	if delete {
		err = targetClient.Delete(ctx, ns)
		if err != nil {
			if apiErrors.IsConflict(err) || apiErrors.IsNotFound(err) {
				// delete triggered
				log.Info("namespace already delete already triggered in target cluster")
				return nil
			}
			log.Error(err, "Failed to delete namespace from target cluster")
			return err
		}
		log.Info("namespace delete triggered in target cluster")
	}

	return nil
}

func (r *InstanceReplicator) setInProgress(instance *osbv1alpha1.SFServiceInstance) error {
	instanceID := instance.GetName()
	state := instance.GetState()
	clusterID, _ := instance.GetClusterID()
	labels := instance.GetLabels()
	if labels == nil {
		labels = make(map[string]string)
	}
	lastOperation, ok := labels[constants.LastOperationKey]
	if !ok {
		lastOperation = "in_queue"
	}

	ctx := context.Background()
	log := r.Log.WithValues("instanceID", instanceID, "clusterID", clusterID)

	err := r.Get(ctx, types.NamespacedName{
		Name:      instanceID,
		Namespace: instance.GetNamespace(),
	}, instance)
	if err != nil {
		log.Error(err, "Failed to fetch sfserviceinstance for setInProgress", "state", state,
			"lastOperation", lastOperation)
		return err
	}

	state = instance.GetState()
	instance.SetState("in progress")
	labels = instance.GetLabels()
	if labels == nil {
		labels = make(map[string]string)
	}
	labels[constants.LastOperationKey] = state
	instance.SetLabels(labels)
	err = r.Update(ctx, instance)
	if err != nil {
		log.Error(err, "Updating status to in progress failed", "state", state,
			"lastOperation", lastOperation, "newLastOperation", state)
		return err
	}
	log.Info("Updated status to in progress", "state", state,
		"lastOperation", lastOperation, "newLastOperation", state)
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

// SetupWithManager registers the MCD Instance replicator with manager
// and setups the watches.
func (r *InstanceReplicator) SetupWithManager(mgr ctrl.Manager) error {
	r.scheme = mgr.GetScheme()

	if r.Log == nil {
		r.Log = ctrl.Log.WithName("mcd").WithName("replicator").WithName("instance")
	}
	if r.clusterRegistry == nil {
		clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
		if err != nil {
			return err
		}
		r.clusterRegistry = clusterRegistry
	}

	// Watch for changes to SFServiceInstance in sister clusters
	watchEvents, err := getWatchChannel("sfserviceinstances")
	if err != nil {
		return err
	}

	metrics.Registry.MustRegister(instancesMetric)

	builder := ctrl.NewControllerManagedBy(mgr).
		Named("mcd_replicator_instance").
		For(&osbv1alpha1.SFServiceInstance{}).
		Watches(&source.Channel{Source: watchEvents}, &handler.EnqueueRequestForObject{}).
		WithEventFilter(watches.NamespaceLabelFilter())

	return builder.Complete(r)
}
