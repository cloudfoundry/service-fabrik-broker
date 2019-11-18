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

package sfroundrobinscheduler

import (
	"context"
	"sort"
	"sync"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

var (
	l                           sync.Mutex
	lastProvisionedClusterIndex = 0
)

// SFRoundRobinScheduler schedules an SFServiceInstance to a cluster
type SFRoundRobinScheduler struct {
	client.Client
	Log    logr.Logger
	scheme *runtime.Scheme
}

// Reconcile schedules the SFServiceInstance to one SFCluster and sets the ClusterID in
// SFServiceInstance.Spec.ClusterID. It chooses the cluster in a round robin fashion
func (r *SFRoundRobinScheduler) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("sfserviceinstance", req.NamespacedName)

	// Fetch the SFRoundRobinScheduler instance
	instance := &osbv1alpha1.SFServiceInstance{}
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
	if instance.Spec.ClusterID == "" {
		clusters := &resourcev1alpha1.SFClusterList{}
		options := &client.ListOptions{}
		err := r.List(ctx, clusters, options)
		if err != nil {
			return ctrl.Result{}, err
		}
		items := clusters.Items
		sort.Slice(items, func(i, j int) bool {
			if items[i].GetCreationTimestamp().Time == items[j].GetCreationTimestamp().Time {
				return items[i].Name < items[j].Name
			}
			return !items[i].GetCreationTimestamp().After(items[j].GetCreationTimestamp().Time)
		})
		l.Lock()
		if len(items) <= lastProvisionedClusterIndex {
			lastProvisionedClusterIndex = 0
		}
		currentlyProvisionedCluster := items[lastProvisionedClusterIndex]
		lastProvisionedClusterIndex++
		l.Unlock()
		instance.Spec.ClusterID = currentlyProvisionedCluster.ObjectMeta.Name
		if err := r.Update(ctx, instance); err != nil {
			log.Error(err, "failed to update cluster id", "ClusterID",
				currentlyProvisionedCluster.ObjectMeta.Name)
			return ctrl.Result{}, err
		}
	}
	return ctrl.Result{}, nil
}

// SetupWithManager registers the round robin scheduler with manager
// add setups the watches.
func (r *SFRoundRobinScheduler) SetupWithManager(mgr ctrl.Manager) error {
	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	if interoperatorCfg.SchedulerType != constants.RoundRobinSchedulerType {
		return nil
	}

	r.scheme = mgr.GetScheme()

	return ctrl.NewControllerManagedBy(mgr).
		Named("scheduler_roundrobin").
		For(&osbv1alpha1.SFServiceInstance{}).
		Complete(r)
}
