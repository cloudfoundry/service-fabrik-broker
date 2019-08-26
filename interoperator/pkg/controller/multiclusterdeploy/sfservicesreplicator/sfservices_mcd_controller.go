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

package sfservices

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/prometheus/common/log"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

/**
* USER ACTION REQUIRED: This is a scaffold file intended for the user to modify with their own Controller
* business logic.  Delete these comments after modifying this file.*
 */

// Add creates a new SFServices Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
// USER ACTION REQUIRED: update cmd/manager/main.go to call this osb.Add(mgr) to install this Controller
func Add(mgr manager.Manager) error {
	clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}

	return add(mgr, newReconciler(mgr, clusterRegistry))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager, clusterRegistry registry.ClusterRegistry) reconcile.Reconciler {
	return &ReconcileSFServices{
		Client:          mgr.GetClient(),
		scheme:          mgr.GetScheme(),
		clusterRegistry: clusterRegistry,
	}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	/*cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}*/
	//interoperatorCfg := cfgManager.GetConfig()
	// Create a new controller
	c, err := controller.New("sfservices-mcd-controller", mgr, controller.Options{
		Reconciler:              r,
		MaxConcurrentReconciles: 1,
	})
	if err != nil {
		return err
	}

	// Watch for changes to SFCluster
	err = c.Watch(&source.Kind{Type: &resourcev1alpha1.SFCluster{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileSFServices{}

// ReconcileSFServices reconciles SFServices state across clusters
type ReconcileSFServices struct {
	client.Client
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile reads that state of the cluster for a SFServices object and makes changes based on the state read
// and what is in the SFServices.Spec
// TODO(user): Modify this Reconcile function to implement your Controller logic.  The scaffolding writes
// a Deployment as an example
func (r *ReconcileSFServices) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the SFCluster
	clusterInstance := &resourcev1alpha1.SFCluster{}
	err := r.Get(context.TODO(), request.NamespacedName, clusterInstance)
	if err != nil {
		log.Error("Failed to get SFCluster", err)
		// Error reading the object - requeue the request.
		return reconcile.Result{}, err
	}

	clusterID := clusterInstance.GetName()
	log.Info("Reconcile started for cluster : ", clusterID)
	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		log.Error("Following error occurred while getting client for cluster ", clusterID, " : ", err)
		return reconcile.Result{}, err
	}

	log.Info("Trying to list all the services in namespace ", request.NamespacedName.Namespace)
	options := kubernetes.InNamespace(request.NamespacedName.Namespace)
	services := &osbv1alpha1.SFServiceList{}
	err = r.List(context.TODO(), options, services)
	if err != nil {
		log.Error("error while fetching services while processing cluster id ", clusterID)
		return reconcile.Result{}, err
	}
	log.Info("No of services fetched ", len(services.Items), " for cluster ", clusterID)
	for _, obj := range services.Items {
		log.Info("Service ", obj.Spec.ID, " is fetched from master cluster..")
		service := &osbv1alpha1.SFService{}
		serviceKey := types.NamespacedName{
			Name:      obj.GetName(),
			Namespace: obj.GetNamespace(),
		}
		log.Info("Checking if service", obj.Spec.ID, " already exists on target cluster ", clusterID)
		err = targetClient.Get(context.TODO(), serviceKey, service)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				replicateSFServiceResourceData(&obj, service)
				err = targetClient.Create(context.TODO(), service)
				if err != nil {
					log.Error("Creating new service on sister cluster failed due to following error: ", err)
					return reconcile.Result{}, err
				}
				log.Info("Creating service ", obj.Spec.Name, " on cluster ", clusterID, " succeeded")
				err := r.handleServicePlans(service, clusterID, &targetClient)
				if err != nil {
					log.Error("Error while replicating plans for service ", service.Spec.Name, " : ", err)
					return reconcile.Result{}, err
				}
			} else {
				log.Error("Getting the service from sister cluster ", clusterID, " failed: ", err)
				return reconcile.Result{}, err
			}
		} else {
			replicateSFServiceResourceData(&obj, service)
			err = targetClient.Update(context.TODO(), service)
			if err != nil {
				log.Error("Updating service on sister cluster failed due to following error: ", err)
				return reconcile.Result{}, err
			}
			log.Info("Updating service ", obj.Spec.Name, " on cluster ", clusterID, " succeeded")
			err = r.handleServicePlans(service, clusterID, &targetClient)
			if err != nil {
				log.Error("Error while replicating plans for service ", service.Spec.Name, " : ", err)
				return reconcile.Result{}, err
			}
		}
	}
	return reconcile.Result{}, nil
}

func (r *ReconcileSFServices) handleServicePlans(service *osbv1alpha1.SFService, clusterID string, targetClient *kubernetes.Client) error {
	log.Info("Trying  to list all the plans for service ", service.Spec.Name, " in the master cluster..")
	plans := &osbv1alpha1.SFPlanList{}
	searchLabels := make(map[string]string)
	searchLabels["serviceId"] = service.Spec.ID
	options := kubernetes.MatchingLabels(searchLabels)
	options.Namespace = service.GetNamespace()
	err := r.List(context.TODO(), options, plans)
	if err != nil {
		log.Error("error while fetching plans while processing cluster id ", clusterID)
		return err
	}
	log.Info("No of plans fetched ", len(plans.Items), " for cluster ", clusterID)
	for _, obj := range plans.Items {
		log.Info("Plan ", obj.Spec.ID, " is fetched from master cluster..")
		plan := &osbv1alpha1.SFPlan{}
		planKey := types.NamespacedName{
			Name:      obj.GetName(),
			Namespace: obj.GetNamespace(),
		}
		log.Info("Checking if plan", obj.Spec.ID, " already exists on target cluster ", clusterID)
		err = (*targetClient).Get(context.TODO(), planKey, plan)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				replicateSFPlanResourceData(&obj, plan)
				err = controllerutil.SetControllerReference(service, plan, r.scheme)
				if err != nil {
					return err
				}
				err = (*targetClient).Create(context.TODO(), plan)
				if err != nil {
					log.Error("Creating new plan on sister cluster failed due to following error: ", err)
					return err
				}
				log.Info("Creating plan ", obj.Spec.Name, " on cluster ", clusterID, " succeeded")
			}
		} else {
			replicateSFPlanResourceData(&obj, plan)
			err = controllerutil.SetControllerReference(service, plan, r.scheme)
			if err != nil {
				return err
			}
			err = (*targetClient).Update(context.TODO(), plan)
			if err != nil {
				log.Error("Updating plan on sister cluster failed due to following error: ", err)
				return err
			}
			log.Info("Updating plan ", obj.Spec.Name, " on cluster ", clusterID, " succeeded")
		}
	}
	return nil
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
