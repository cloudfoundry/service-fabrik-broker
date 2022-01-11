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

package sfclusterreplicator

import (
	"context"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/watchmanager"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	"github.com/prometheus/client_golang/prometheus"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/metrics"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var (
	allocatableMetric = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name:      "allocatable",
			Namespace: "interoperator",
			Subsystem: "cluster",
			Help:      "Allocatable resources partitioned by cluster and resource type",
		},
		[]string{
			// Which cluster?
			"cluster",

			// Type of the resource
			"type",
		},
	)
	instancesMetric = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name:      "service_instances",
			Namespace: "interoperator",
			Subsystem: "cluster",
			Help:      "Number of service instances partitioned by cluster",
		},
		[]string{
			// Which cluster?
			"cluster",
		},
	)
)

// To the function mock
var getWatchChannel = watchmanager.GetWatchChannel

// SFClusterReplicator replicates SFCluster
type SFClusterReplicator struct {
	client.Client
	Log             logr.Logger
	clusterRegistry registry.ClusterRegistry
	cfgManager      config.Config
}

// Reconcile reads that state of the cluster for a SFCluster object on master and sister clusters
// and replicates it.
func (r *SFClusterReplicator) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("sfcluster", req.NamespacedName)

	cluster := &resourcev1alpha1.SFCluster{}
	replica := &resourcev1alpha1.SFCluster{}
	err := r.Get(ctx, req.NamespacedName, cluster)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	clusterID := cluster.GetName()

	allocatable := cluster.Status.TotalCapacity.DeepCopy()
	if allocatable == nil || len(allocatable) == 0 {
		allocatable = cluster.Status.CurrentCapacity.DeepCopy()
	}
	resourcev1alpha1.ResourceListSub(allocatable, cluster.Status.Requests)
	for key, quantity := range allocatable {
		allocatableMetric.WithLabelValues(clusterID, key.String()).Set(float64(quantity.Value()))
	}
	instancesMetric.WithLabelValues(clusterID).Set(float64(cluster.Status.ServiceInstanceCount))

	// Fetch current primary cluster id from configmap
	interoperatorCfg := r.cfgManager.GetConfig()
	currPrimaryClusterID := interoperatorCfg.PrimaryClusterID

	if clusterID == currPrimaryClusterID {
		// Target cluster is mastercluster itself
		// Replication not needed
		return ctrl.Result{}, nil
	}

	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		return ctrl.Result{}, err
	}
	err = targetClient.Get(ctx, req.NamespacedName, replica)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.
			log.Info("sfcluster not found in sister. ignoring")
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	err = r.reconcileSpec(targetClient, cluster, replica)
	if err != nil {
		return ctrl.Result{}, err
	}

	err = r.reconcileStatus(targetClient, cluster, replica)
	if err != nil {
		return ctrl.Result{}, err
	}

	return ctrl.Result{}, nil
}

func (r *SFClusterReplicator) reconcileSpec(targetClient client.Client, cluster, replica *resourcev1alpha1.SFCluster) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", cluster.GetName())

	err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
		updateRequired := false
		if cluster.Spec.SchedulingLimitPercentage != replica.Spec.SchedulingLimitPercentage {
			updateRequired = true
			replica.Spec.SchedulingLimitPercentage = cluster.Spec.SchedulingLimitPercentage
		}

		if !resourcev1alpha1.ResourceListEqual(cluster.Spec.TotalCapacity, replica.Spec.TotalCapacity) {
			updateRequired = true
			replica.Spec.TotalCapacity = cluster.Spec.TotalCapacity.DeepCopy()
		}

		if cluster.Spec.SecretRef != replica.Spec.SecretRef {
			updateRequired = true
			replica.Spec.SecretRef = cluster.Spec.SecretRef
		}

		if updateRequired {
			err := targetClient.Update(ctx, replica)
			if err != nil {
				if apiErrors.IsConflict(err) {
					namespacedName := types.NamespacedName{
						Name:      cluster.GetName(),
						Namespace: cluster.GetNamespace(),
					}
					_ = targetClient.Get(ctx, namespacedName, replica)
				}
				return err
			}
			log.Info("updated cluster spec on sister cluster")
		}
		return nil
	})
	if err != nil {
		log.Error(err, "failed to update cluster spec on sister cluster")
		return err
	}
	return nil
}

func (r *SFClusterReplicator) reconcileStatus(targetClient client.Client, cluster, replica *resourcev1alpha1.SFCluster) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", cluster.GetName())

	err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
		updateRequired := false
		if !resourcev1alpha1.ResourceListEqual(cluster.Status.CurrentCapacity, replica.Status.CurrentCapacity) {
			updateRequired = true
			cluster.Status.CurrentCapacity = replica.Status.CurrentCapacity.DeepCopy()
		}
		if !resourcev1alpha1.ResourceListEqual(cluster.Status.TotalCapacity, replica.Status.TotalCapacity) {
			updateRequired = true
			cluster.Status.TotalCapacity = replica.Status.TotalCapacity.DeepCopy()
		}
		if !resourcev1alpha1.ResourceListEqual(cluster.Status.Requests, replica.Status.Requests) {
			updateRequired = true
			cluster.Status.Requests = replica.Status.Requests.DeepCopy()
		}

		if updateRequired {
			err := r.Status().Update(ctx, cluster)
			if err != nil {
				if apiErrors.IsConflict(err) {
					namespacedName := types.NamespacedName{
						Name:      cluster.GetName(),
						Namespace: cluster.GetNamespace(),
					}
					_ = r.Get(ctx, namespacedName, cluster)
				}
				return err
			}
			log.Info("updated cluster status from sister cluster")
		}
		return nil
	})
	if err != nil {
		log.Error(err, "failed to update cluster status from sister cluster")
		return err
	}
	return nil
}

// SetupWithManager registers the MCD SFCluster replicator with manager
// and setups the watches.
func (r *SFClusterReplicator) SetupWithManager(mgr ctrl.Manager) error {
	if r.Log == nil {
		r.Log = ctrl.Log.WithName("mcd").WithName("replicator").WithName("cluster")
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
	r.cfgManager = cfgManager

	// Watch for changes to SFCluster in sister clusters
	watchEvents, err := getWatchChannel("sfclusters")
	if err != nil {
		return err
	}

	metrics.Registry.MustRegister(allocatableMetric, instancesMetric)

	builder := ctrl.NewControllerManagedBy(mgr).
		Named("mcd_replicator_cluster").
		For(&resourcev1alpha1.SFCluster{}).
		Watches(&source.Channel{Source: watchEvents}, &handler.EnqueueRequestForObject{}).
		WithEventFilter(watches.NamespaceFilter())

	return builder.Complete(r)
}
