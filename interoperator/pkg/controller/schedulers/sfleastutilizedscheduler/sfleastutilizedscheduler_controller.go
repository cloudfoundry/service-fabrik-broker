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

package sfleastutilizedscheduler

import (
	"context"
	"math"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/config"

	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var log = logf.Log.WithName("sfleastutilized.scheduler")

// Add creates a new SFLeastUtilizedScheduler Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
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
	return &ReconcileSFLeastUtilizedScheduler{
		Client:          mgr.GetClient(),
		scheme:          mgr.GetScheme(),
		clusterRegistry: clusterRegistry,
	}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	if interoperatorCfg.SchedulerType != constants.LeastUtilizedSchedulerType {
		return nil
	}

	// Create a new controller
	c, err := controller.New("sfleastutilizedscheduler-controller", mgr, controller.Options{Reconciler: r})
	if err != nil {
		return err
	}

	// Watch for changes to SFLeastUtilizedScheduler
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.SFServiceInstance{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileSFLeastUtilizedScheduler{}

// ReconcileSFLeastUtilizedScheduler reconciles a SFLeastUtilizedScheduler object
type ReconcileSFLeastUtilizedScheduler struct {
	client.Client
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile schedules the SFServiceInstance to one SFCluster and sets the ClusterID in
// SFServiceInstance.Spec.ClusterID. It chooses the cluster with least number of
// SFServiceInstances already deployed
func (r *ReconcileSFLeastUtilizedScheduler) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	ctx := context.TODO()
	// Fetch the SFLeastUtilizedScheduler instance
	instance := &osbv1alpha1.SFServiceInstance{}
	err := r.Get(ctx, request.NamespacedName, instance)
	if err != nil {
		if errors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return reconcile.Result{}, err
	}

	if instance.Spec.ClusterID == "" {
		clusters, err := r.clusterRegistry.ListClusters(&client.ListOptions{})
		if err != nil {
			return reconcile.Result{}, err
		}

		sfserviceinstances := &osbv1alpha1.SFServiceInstanceList{}
		err = r.List(ctx, &client.ListOptions{}, sfserviceinstances)
		if err != nil {
			log.Error(err, "failed to list all sfserviceinstances")
			return reconcile.Result{}, err
		}

		counts := make(map[string]int64)
		for _, item := range sfserviceinstances.Items {
			if item.Spec.ClusterID != "" {
				counts[item.Spec.ClusterID] = counts[item.Spec.ClusterID] + 1
			}
		}

		leastCount := int64(math.MaxInt64)
		var clusterID string
		for _, cluster := range clusters.Items {
			count := counts[cluster.GetName()]
			if count < leastCount {
				leastCount = count
				clusterID = cluster.GetName()
				if count == 0 {
					break
				}
			}
		}

		if clusterID != "" {
			log.Info("setting clusterID", "instanceID", instance.GetName(), "clusterID", clusterID, "leastCount", leastCount)
			instance.Spec.ClusterID = clusterID
			if err := r.Update(ctx, instance); err != nil {
				log.Error(err, "failed to set cluster id", "instanceID", instance.GetName(), "clusterID", clusterID)
				return reconcile.Result{}, err
			}
		}
	}

	return reconcile.Result{}, nil
}
