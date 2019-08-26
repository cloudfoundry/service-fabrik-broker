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

package provisioner

import (
	"context"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/provisioner"
	"github.com/prometheus/common/log"
	appsv1 "k8s.io/api/apps/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
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

// Add creates a new SFDefaultScheduler Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
// USER ACTION REQUIRED: update cmd/manager/main.go to call this osb.Add(mgr) to install this Controller
func Add(mgr manager.Manager) error {
	clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	provisionerMgr, err := provisioner.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	err = provisionerMgr.FetchStatefulset()
	if err != nil {
		return err
	}

	return add(mgr, newReconciler(mgr, clusterRegistry, provisionerMgr))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager, clusterRegistry registry.ClusterRegistry, provisionerMgr provisioner.Provisioner) reconcile.Reconciler {
	return &ReconcileProvisioner{
		Client:          mgr.GetClient(),
		scheme:          mgr.GetScheme(),
		clusterRegistry: clusterRegistry,
		provisioner:     provisionerMgr,
	}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	// Create a new controller
	c, err := controller.New("provisioner-controller", mgr, controller.Options{
		Reconciler:              r,
		MaxConcurrentReconciles: interoperatorCfg.SchedulerWorkerCount,
	})
	if err != nil {
		return err
	}

	// Watch for changes to SFDefaultScheduler
	err = c.Watch(&source.Kind{Type: &resourcev1alpha1.SFCluster{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileProvisioner{}

// ReconcileProvisioner reconciles a SFDefaultScheduler object
type ReconcileProvisioner struct {
	client.Client
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
	provisioner     provisioner.Provisioner
}

// Reconcile reads that state of the cluster for a SFDefaultScheduler object and makes changes based on the state read
// and what is in the SFDefaultScheduler.Spec
// TODO(user): Modify this Reconcile function to implement your Controller logic.  The scaffolding writes
// a Deployment as an example
func (r *ReconcileProvisioner) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	log.Info("Im here")
	// Fetch the SFCluster
	clusterInstance := &resourcev1alpha1.SFCluster{}
	err := r.Get(context.TODO(), request.NamespacedName, clusterInstance)
	if err != nil {
		log.Error("Failed to get SFCluster", err)
		// Error reading the object - requeue the request.
		return reconcile.Result{}, err
	}
	clusterID := clusterInstance.GetName()
	log.Info("Cluster id is ", clusterID)

	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		return reconcile.Result{}, err
	}
	statefulSetInstance := r.provisioner.GetStatefulSet()
	provisionerInstance := &appsv1.StatefulSet{}
	statefulSetInstance.Spec.DeepCopyInto(&provisionerInstance.Spec)
	replicaCount := int32(1)
	provisionerInstance.SetName("haha")
	provisionerInstance.SetNamespace("default")
	provisionerInstance.Spec.Replicas = &replicaCount

	log.Info("Deploying provisioner in cluster ", clusterID)
	err = targetClient.Update(context.TODO(), provisionerInstance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			err = targetClient.Create(context.TODO(), provisionerInstance)
			if err != nil {
				return reconcile.Result{}, err
			}
			return reconcile.Result{}, nil
		}
		log.Error("Error occurred", err)
		return reconcile.Result{}, err
	}

	return reconcile.Result{}, nil
}
