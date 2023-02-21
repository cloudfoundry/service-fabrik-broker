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
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	"github.com/prometheus/client_golang/prometheus"
	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
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
			"state",
			"creation_timestamp",
			"deletion_timestamp",
			"service_id",
			"plan_id",
			"organization_guid",
			"space_guid",
			"sf_namespace",
			"last_operation",
		},
	)
)

// To the function mock
var getWatchChannel = watchmanager.GetWatchChannel

// InstanceReplicator replicates a SFServiceInstance object to sister cluster
type InstanceReplicator struct {
	client.Client
	Log             logr.Logger
	clusterRegistry registry.ClusterRegistry
	cfgManager      config.Config
}

// Reconcile reads that state of the cluster for a SFServiceInstance object on master and sister cluster
// and replicates it.
func (r *InstanceReplicator) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
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
	//labelsForMetrics := instance.GetLabelsForMetrics()
	creationTimestamp := instance.GetCreationTimestamp().String()
	deletionTimestamp := instance.GetDeletionTimestampForMetrics()
	serviceId := instance.Spec.ServiceID
	planId := instance.Spec.PlanID
	organizationGuid := instance.Spec.OrganizationGUID
	spaceGuid := instance.Spec.SpaceGUID
	sfNamespace := instance.GetNamespace()
	lastOperation := instance.GetLastOperation()

	switch state {
	case "succeeded":
		instancesMetric.WithLabelValues(instanceID, state, creationTimestamp, deletionTimestamp, serviceId, planId, organizationGuid, spaceGuid, sfNamespace, lastOperation).Set(0)
	case "failed":
		instancesMetric.WithLabelValues(instanceID, state, creationTimestamp, deletionTimestamp, serviceId, planId, organizationGuid, spaceGuid, sfNamespace, lastOperation).Set(1)
	case "in progress":
		instancesMetric.WithLabelValues(instanceID, state, creationTimestamp, deletionTimestamp, serviceId, planId, organizationGuid, spaceGuid, sfNamespace, lastOperation).Set(2)
	case "in_queue":
	case "update":
	case "delete":
		instancesMetric.WithLabelValues(instanceID, state, creationTimestamp, deletionTimestamp, serviceId, planId, organizationGuid, spaceGuid, sfNamespace, lastOperation).Set(3)
	}

	clusterID, err := instance.GetClusterID()
	if err != nil {
		log.Info("clusterID not set. Ignoring", "instance", instanceID)
		return ctrl.Result{}, nil
	}

	// Fetch current primary cluster id from configmap
	interoperatorCfg := r.cfgManager.GetConfig()
	currPrimaryClusterID := interoperatorCfg.PrimaryClusterID

	reconcileErr := r.reconcileSFPlan(instance, clusterID, !instance.GetDeletionTimestamp().IsZero())
	if reconcileErr != nil {
		log.Error(reconcileErr, "Failed to reconcile SFPlan")
	}

	if clusterID == currPrimaryClusterID {
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
	// Broker trigger namespace deletion along with instance deletion
	err = r.reconcileNamespace(targetClient, instance.GetNamespace(), clusterID,
		!instance.GetDeletionTimestamp().IsZero())
	if err != nil {
		return ctrl.Result{}, err
	}
	lastErr := r.reconcileServicePlan(targetClient, instance, clusterID)

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
			if apiErrors.IsNotFound(err) && state != "delete" {
				copyObject(instance, replica, true)
				err = targetClient.Create(ctx, replica)
				if err != nil {
					log.Error(err, "Error occurred while replicating SFServiceInstance to cluster ",
						"state", state, "lastOperation", lastOperation)
					return ctrl.Result{}, err
				}
				log.Info("sfserviceinstance not found in target cluster. created as copy from master", "state", state, "lastOperation", lastOperation)
			} else if !apiErrors.IsNotFound(err) {
				log.Error(err, "Failed to fetch SFServiceInstance from target cluster", "state", state, "lastOperation", lastOperation)
				// Error reading the object - requeue the request.
				return ctrl.Result{}, err
			}
		} else {
			copyObject(instance, replica, true)
			err = targetClient.Update(ctx, replica)
			if err != nil {
				log.Error(err, "Error occurred while replicating SFServiceInstance to cluster ",
					"state", state, "lastOperation", lastOperation)
				return ctrl.Result{}, err
			}
			log.Info("updated sfserviceinstance in target cluster", "state", state, "lastOperation", lastOperation)
		}

		err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
			return r.setInProgress(instance, state)
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
			copyObject(replica, instance, false)
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

	if lastErr != nil {
		// re que if service/plan replication failed
		return ctrl.Result{}, err
	}

	return ctrl.Result{}, nil
}

func (r *InstanceReplicator) reconcileSFPlan(instance *osbv1alpha1.SFServiceInstance, clusterID string, deleted bool) error {
	ctx := context.Background()
	serviceID := instance.Spec.ServiceID
	planID := instance.Spec.PlanID
	log := r.Log.WithValues("clusterID", clusterID, "serviceID", serviceID, "planID", planID)

	var lastErr error

	plan := &osbv1alpha1.SFPlan{}
	planKey := types.NamespacedName{
		Name:      planID,
		Namespace: constants.InteroperatorNamespace,
	}

	err := r.Get(ctx, planKey, plan)
	log.Info("Checking deletion eligibility for the plan", "is instance set for deletion: ", deleted, "is deletion ts for the plan set", !plan.GetDeletionTimestamp().IsZero())
	if err != nil {
		log.Error(err, "Failed to get SFPlan from leader")
		lastErr = err
	} else if deleted && !plan.GetDeletionTimestamp().IsZero() {
		annotations := plan.GetAnnotations()
		if annotations == nil {
			annotations = make(map[string]string)
		}
		deleteAttempts, ok := annotations[constants.PlanDeleteAttempts]
		/* Since the SFPlan's reconciler, "offboarding_sfplan_controller", is not watching on instances, there is no way to delete the plan
		   when all its corresponding instances have been deleted,once the deletion timestamp is set for the plan.
		   Hence everytime any instance created using this plan is attempted to be deleted, the below code will force trigger
		   the reconciliation, hence deleting the plan when all the instances created using this plan have been deleted or set to be deleted.
		*/
		switch {
		case deleteAttempts == "true":
			annotations[constants.PlanDeleteAttempts] = "yes"
		case deleteAttempts == "yes":
			annotations[constants.PlanDeleteAttempts] = "true"
		case !ok:
			annotations[constants.PlanDeleteAttempts] = "true"
		}
		plan.SetAnnotations(annotations)
		r.Update(ctx, plan)
	}

	return lastErr
}

func (r *InstanceReplicator) reconcileNamespace(targetClient client.Client, namespace, clusterID string, delete bool) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", clusterID, "namespace", namespace, "deleteNamespace", delete)

	ns := &corev1.Namespace{}

	// Verify namespace needs to be deleted.
	// If namespaced_separation is disabled the ns need not be deleted.
	// Trigger delete only if the namespace is being deleted in master
	sourceDeleting := false
	if delete {
		sourceNs := &corev1.Namespace{}
		err := r.Get(ctx, types.NamespacedName{
			Name: namespace,
		}, sourceNs)
		if err != nil {
			if !apiErrors.IsNotFound(err) {
				log.Error(err, "Failed to get namespace in master cluster")
				return err
			}
			// Namespace is deleted in master
			sourceDeleting = true
		} else if !sourceNs.GetDeletionTimestamp().IsZero() {
			sourceDeleting = true
		}
	}

	err := targetClient.Get(ctx, types.NamespacedName{
		Name: namespace,
	}, ns)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			if delete && sourceDeleting {
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
	if delete && sourceDeleting {
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

func (r *InstanceReplicator) reconcileServicePlan(targetClient client.Client, instance *osbv1alpha1.SFServiceInstance, clusterID string) error {
	ctx := context.Background()
	serviceID := instance.Spec.ServiceID
	planID := instance.Spec.PlanID
	log := r.Log.WithValues("clusterID", clusterID, "serviceID", serviceID, "planID", planID)

	var lastErr error

	service, serviceReplica := &osbv1alpha1.SFService{}, &osbv1alpha1.SFService{}
	serviceKey := types.NamespacedName{
		Name:      serviceID,
		Namespace: constants.InteroperatorNamespace,
	}

	plan, planReplica := &osbv1alpha1.SFPlan{}, &osbv1alpha1.SFPlan{}
	planKey := types.NamespacedName{
		Name:      planID,
		Namespace: constants.InteroperatorNamespace,
	}

	err := r.Get(ctx, serviceKey, service)
	if err != nil {
		log.Error(err, "Failed to get SFService from leader")
		lastErr = err
	}

	err = targetClient.Get(ctx, serviceKey, serviceReplica)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			replicateSFServiceResourceData(service, serviceReplica)
			err = targetClient.Create(ctx, serviceReplica)
			if err != nil {
				log.Error(err, "Error occurred while replicating SFService to cluster ")
				lastErr = err
			} else {
				log.Info("SFService not found in target cluster. created as copy from leader")
			}
		} else if !apiErrors.IsNotFound(err) {
			log.Error(err, "Failed to fetch SFService from target cluster")
			lastErr = err
		}
	} else {
		replicateSFServiceResourceData(service, serviceReplica)
		err = targetClient.Update(ctx, serviceReplica)
		if err != nil {
			log.Error(err, "Error occurred while updating SFService to cluster")
			lastErr = err
		} else {
			log.Info("updated SFService in target cluster")
		}
	}

	err = r.Get(ctx, planKey, plan)
	if err != nil {
		log.Error(err, "Failed to get SFPlan from leader")
		lastErr = err
	}

	err = targetClient.Get(ctx, planKey, planReplica)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			replicateSFPlanResourceData(plan, planReplica)
			err = utils.SetOwnerReference(serviceReplica, planReplica, r.Scheme())
			if err != nil {
				lastErr = err
			}
			err = targetClient.Create(ctx, planReplica)
			if err != nil {
				log.Error(err, "Error occurred while replicating SFPlan to cluster ")
				lastErr = err
			} else {
				log.Info("SFPlan not found in target cluster. created as copy from leader")
			}
		} else if !apiErrors.IsNotFound(err) {
			log.Error(err, "Failed to fetch SFPlan from target cluster")
			lastErr = err
		}
	} else {
		replicateSFPlanResourceData(plan, planReplica)
		err = utils.SetOwnerReference(serviceReplica, planReplica, r.Scheme())
		if err != nil {
			return err
		}
		err = targetClient.Update(ctx, planReplica)
		if err != nil {
			log.Error(err, "Error occurred while replicating SFPlan to cluster")
			lastErr = err
		} else {
			log.Info("updated SFPlan in target cluster")
		}
	}

	return lastErr
}

func (r *InstanceReplicator) setInProgress(instance *osbv1alpha1.SFServiceInstance, state string) error {
	instanceID := instance.GetName()
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

	curentState := instance.GetState()
	if curentState != state {
		log.Info("Error while trying to set in progress. state mismatch", "state", state,
			"currentState", curentState, "lastOperation", lastOperation)
		// Will get requeued since a change has happened
		return nil
	}
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

func copyObject(source, destination *osbv1alpha1.SFServiceInstance, preserveResources bool) {
	destination.SetName(source.GetName())
	destination.SetNamespace(source.GetNamespace())
	destination.SetLabels(source.GetLabels())
	destination.SetAnnotations(source.GetAnnotations())
	source.Spec.DeepCopyInto(&destination.Spec)

	// Do not overwrite resources array in sister cluster
	if preserveResources {
		resources := make([]osbv1alpha1.Source, len(destination.Status.Resources))
		copy(resources, destination.Status.Resources)
		source.Status.DeepCopyInto(&destination.Status)
		destination.Status.Resources = resources
	} else {
		source.Status.DeepCopyInto(&destination.Status)
	}
}

func replicateSFServiceResourceData(source *osbv1alpha1.SFService, dest *osbv1alpha1.SFService) {
	source.Spec.DeepCopyInto(&dest.Spec)
	dest.SetName(source.GetName())
	dest.SetNamespace(source.GetNamespace())
	dest.SetLabels(source.GetLabels())
}

func replicateSFPlanResourceData(source *osbv1alpha1.SFPlan, dest *osbv1alpha1.SFPlan) {
	source.Spec.DeepCopyInto(&dest.Spec)
	dest.SetName(source.GetName())
	dest.SetNamespace(source.GetNamespace())
	dest.SetLabels(source.GetLabels())
}

// SetupWithManager registers the MCD Instance replicator with manager
// and setups the watches.
func (r *InstanceReplicator) SetupWithManager(mgr ctrl.Manager) error {
	if r.Log.GetSink() == nil {
		r.Log = ctrl.Log.WithName("mcd").WithName("replicator").WithName("instance")
	}
	if r.clusterRegistry == nil {
		clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
		if err != nil {
			return err
		}
		r.clusterRegistry = clusterRegistry
	}

	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	r.cfgManager = cfgManager

	// Watch for changes to SFServiceInstance in sister clusters
	watchEvents, err := getWatchChannel("sfserviceinstances")
	if err != nil {
		return err
	}

	metrics.Registry.MustRegister(instancesMetric)

	builder := ctrl.NewControllerManagedBy(mgr).
		Named("mcd_replicator_instance").
		WithOptions(controller.Options{
			MaxConcurrentReconciles: interoperatorCfg.InstanceWorkerCount,
		}).
		For(&osbv1alpha1.SFServiceInstance{}).
		Watches(&source.Channel{Source: watchEvents}, &handler.EnqueueRequestForObject{}).
		WithEventFilter(watches.NamespaceLabelFilter())

	return builder.Complete(r)
}
