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

package sfserviceinstancemetrics

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/watchmanager"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	"github.com/prometheus/client_golang/prometheus"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
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
			Subsystem: "service_instances_metrics",
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
type InstanceMetrics struct {
	client.Client
	Log             logr.Logger
	clusterRegistry registry.ClusterRegistry
	cfgManager      config.Config
}

// Reconcile reads that state of the cluster for a SFServiceInstance object on master and sister cluster
// and replicates it.
func (r *InstanceMetrics) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("InstanceMetrics", req.NamespacedName)

	// Fetch the SFServiceInstanceReplicator instance
	instance := &osbv1alpha1.SFServiceInstance{}
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

	log.Info("Sending Metrics to prometheus for instance ", instanceID)

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

	/*switch state {
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
	}*/
	return ctrl.Result{}, nil
}

/*func (r *InstanceMetrics) setInProgress(instance *osbv1alpha1.SFServiceInstance, state string) error {
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
}*/

// SetupWithManager registers the MCD Instance replicator with manager
// and setups the watches.
func (r *InstanceMetrics) SetupWithManager(mgr ctrl.Manager) error {
	if r.Log.GetSink() == nil {
		r.Log = ctrl.Log.WithName("mcd").WithName("metrics").WithName("instance")
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
		Named("mcd_metrics_instance").
		WithOptions(controller.Options{
			MaxConcurrentReconciles: interoperatorCfg.InstanceWorkerCount,
		}).
		For(&osbv1alpha1.SFServiceInstance{}).
		Watches(&source.Channel{Source: watchEvents}, &handler.EnqueueRequestForObject{}).
		WithEventFilter(watches.NamespaceLabelFilter())

	return builder.Complete(r)
}
