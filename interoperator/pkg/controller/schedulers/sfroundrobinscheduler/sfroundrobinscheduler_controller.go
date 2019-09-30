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

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/config"
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

var (
	l                           sync.Mutex
	lastProvisionedClusterIndex = 0
)

/**
* USER ACTION REQUIRED: This is a scaffold file intended for the user to modify with their own Controller
* business logic.  Delete these comments after modifying this file.*
 */

// Add creates a new SFRoundRobinScheduler Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
// USER ACTION REQUIRED: update cmd/manager/main.go to call this osb.Add(mgr) to install this Controller
func Add(mgr manager.Manager) error {
	return add(mgr, newReconciler(mgr))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager) reconcile.Reconciler {
	return &ReconcileSFRoundRobinScheduler{Client: mgr.GetClient(), scheme: mgr.GetScheme()}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	if interoperatorCfg.SchedulerType != constants.RoundRobinSchedulerType {
		return nil
	}
	// Create a new controller
	c, err := controller.New("sfroundrobinscheduler-controller", mgr, controller.Options{
		Reconciler:              r,
		MaxConcurrentReconciles: interoperatorCfg.SchedulerWorkerCount,
	})
	if err != nil {
		return err
	}

	// Watch for changes to SFServiceInstance
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.SFServiceInstance{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileSFRoundRobinScheduler{}

// ReconcileSFRoundRobinScheduler reconciles a SFServiceInstance object
type ReconcileSFRoundRobinScheduler struct {
	client.Client
	scheme *runtime.Scheme
}

// Reconcile reads that state of the cluster for a SFRoundRobinScheduler object and makes changes based on the state read
// and what is in the SFRoundRobinScheduler.Spec
// TODO(user): Modify this Reconcile function to implement your Controller logic.  The scaffolding writes
// a Deployment as an example
func (r *ReconcileSFRoundRobinScheduler) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the SFRoundRobinScheduler instance
	instance := &osbv1alpha1.SFServiceInstance{}
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
	if instance.Spec.ClusterID == "" {
		clusters := &resourcev1alpha1.SFClusterList{}
		options := &client.ListOptions{}
		err := r.List(context.TODO(), options, clusters)
		if err != nil {
			return reconcile.Result{}, err
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
		if err := r.Update(context.Background(), instance); err != nil {
			log.Error(err, "failed to update cluster id for ", "sfroundrobincontroller", instance.GetName())
			return reconcile.Result{}, err
		}
	}
	return reconcile.Result{}, nil
}
