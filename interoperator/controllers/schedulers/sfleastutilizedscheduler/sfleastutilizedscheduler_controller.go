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

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"github.com/go-logr/logr"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// SFLeastUtilizedScheduler reconciles a SFLeastUtilizedScheduler object
type SFLeastUtilizedScheduler struct {
	client.Client
	Log             logr.Logger
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile schedules the SFServiceInstance to one SFCluster and sets the ClusterID in
// SFServiceInstance.Spec.ClusterID. It chooses the cluster with least number of
// SFServiceInstances already deployed
func (r *SFLeastUtilizedScheduler) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("sfserviceinstance", req.NamespacedName)

	// Fetch the SFLeastUtilizedScheduler instance
	instance := &osbv1alpha1.SFServiceInstance{}
	err := r.Get(ctx, req.NamespacedName, instance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	if instance.Spec.ClusterID == "" {
		clusterID, err := r.schedule()
		if err != nil {
			return ctrl.Result{}, err
		}

		if clusterID != "" {
			log.V(0).Info("setting clusterID", "clusterID", clusterID)
			instance.Spec.ClusterID = clusterID
			if err := r.Update(ctx, instance); err != nil {
				log.Error(err, "failed to set cluster id", "clusterID", clusterID)
				return ctrl.Result{}, err
			}
		}
	}

	return ctrl.Result{}, nil
}

func (r *SFLeastUtilizedScheduler) schedule() (string, error) {
	log := r.Log

	clusters, err := r.clusterRegistry.ListClusters(&client.ListOptions{})
	if err != nil {
		return "", err
	}

	if len(clusters.Items) == 0 {
		return "", errors.NewClusterRegistryError("no sfcluster found", nil)
	} else if len(clusters.Items) == 1 {
		return clusters.Items[0].GetName(), nil
	}

	sfserviceinstances := &osbv1alpha1.SFServiceInstanceList{}
	err = r.List(context.TODO(), sfserviceinstances, &client.ListOptions{})
	if err != nil {
		log.Error(err, "failed to list all sfserviceinstances")
		return "", err
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
	return clusterID, nil
}

// SetupWithManager registers the least utilized scheduler with manager
// and setups the watches.
func (r *SFLeastUtilizedScheduler) SetupWithManager(mgr ctrl.Manager) error {
	clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	r.clusterRegistry = clusterRegistry

	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	if interoperatorCfg.SchedulerType != constants.LeastUtilizedSchedulerType {
		return nil
	}

	r.scheme = mgr.GetScheme()

	return ctrl.NewControllerManagedBy(mgr).
		Named("scheduler_leastutilized").
		For(&osbv1alpha1.SFServiceInstance{}).
		Complete(r)
}
