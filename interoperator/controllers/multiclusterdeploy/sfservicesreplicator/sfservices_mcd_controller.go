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

package sfservicesreplicator

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

// ReconcileSFServices reconciles SFServices state across clusters
type ReconcileSFServices struct {
	kubernetes.Client
	Log             logr.Logger
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile is called for a SFCluster. It replicates all SFServices and all SFPlans to
// the SFCluster
func (r *ReconcileSFServices) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("sfcluster", req.NamespacedName)

	// Fetch the SFCluster
	clusterInstance := &resourcev1alpha1.SFCluster{}
	err := r.Get(ctx, req.NamespacedName, clusterInstance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.
			return ctrl.Result{}, nil
		}
		log.Error(err, "Failed to get SFCluster")
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	clusterID := clusterInstance.GetName()
	log.Info("Reconcile started for cluster", "clusterID", clusterID)
	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		log.Error(err, "Following error occurred while getting client for cluster ", "clusterID", clusterID)
		return ctrl.Result{}, err
	}

	log.Info("Trying to list all the services", "namespace", req.NamespacedName.Namespace)
	options := &kubernetes.ListOptions{
		Namespace: req.NamespacedName.Namespace,
	}
	services := &osbv1alpha1.SFServiceList{}
	err = r.List(ctx, services, options)
	if err != nil {
		log.Error(err, "error while fetching services while processing cluster id ", "clusterID", clusterID)
		return ctrl.Result{}, err
	}
	log.Info("services fetched ", "count", len(services.Items), "clusterID", clusterID)
	for _, obj := range services.Items {
		log.Info("Service is fetched from master cluster", "serviceID", obj.Spec.ID)
		service := &osbv1alpha1.SFService{}
		serviceKey := types.NamespacedName{
			Name:      obj.GetName(),
			Namespace: obj.GetNamespace(),
		}
		log.Info("Checking if service already exists on target cluster", "serviceID", obj.Spec.ID, "clusterID", clusterID)
		err = targetClient.Get(ctx, serviceKey, service)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				replicateSFServiceResourceData(&obj, service)
				err = targetClient.Create(ctx, service)
				if err != nil {
					log.Error(err, "Creating new service on sister cluster failed due to following error: ")
					return ctrl.Result{}, err
				}
				log.Info("Created service on cluster", "serviceName", service.Spec.Name, "clusterID", clusterID)
				err := r.handleServicePlans(service, clusterID, &targetClient)
				if err != nil {
					log.Error(err, "Error while replicating plans for service ", "serviceName", service.Spec.Name)
					return ctrl.Result{}, err
				}
			} else {
				log.Error(err, "Getting the service from sister cluster ", "clusterID", clusterID)
				return ctrl.Result{}, err
			}
		} else {
			replicateSFServiceResourceData(&obj, service)
			err = targetClient.Update(ctx, service)
			if err != nil {
				log.Error(err, "Updating service on sister cluster failed due to following error: ")
				return ctrl.Result{}, err
			}
			log.Info("Updated service on cluster", "serviceName", service.Spec.Name, "clusterID", clusterID)
			err = r.handleServicePlans(service, clusterID, &targetClient)
			if err != nil {
				log.Error(err, "Error while replicating plans for service ", "serviceName", service.Spec.Name)
				return ctrl.Result{}, err
			}
		}
	}
	return ctrl.Result{}, nil
}

func (r *ReconcileSFServices) handleServicePlans(service *osbv1alpha1.SFService, clusterID string, targetClient *kubernetes.Client) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", clusterID)

	log.Info("Trying  to list all the plans for service in the master cluster", "serviceName", service.Spec.Name)
	plans := &osbv1alpha1.SFPlanList{}
	searchLabels := make(kubernetes.MatchingLabels)
	searchLabels["serviceId"] = service.Spec.ID
	options := &kubernetes.ListOptions{
		Namespace: service.GetNamespace(),
	}
	searchLabels.ApplyToList(options)
	err := r.List(ctx, plans, options)
	if err != nil {
		log.Error(err, "error while fetching plans while processing cluster id ", "clusterID", clusterID)
		return err
	}
	log.Info("plans fetched for cluster", "count", len(plans.Items), "clusterID", clusterID)
	for _, obj := range plans.Items {
		log.Info("Plan is fetched from master cluster", "planID", obj.Spec.ID)
		plan := &osbv1alpha1.SFPlan{}
		planKey := types.NamespacedName{
			Name:      obj.GetName(),
			Namespace: obj.GetNamespace(),
		}
		log.Info("Checking if plan already exists on target cluster", "clusterID", clusterID, "planID", obj.Spec.ID)
		err = (*targetClient).Get(ctx, planKey, plan)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				replicateSFPlanResourceData(&obj, plan)
				err = utils.SetOwnerReference(service, plan, r.scheme)
				if err != nil {
					return err
				}
				err = (*targetClient).Create(ctx, plan)
				if err != nil {
					log.Error(err, "Creating new plan on sister cluster failed")
					return err
				}
				log.Info("Created plan on cluster", "clusterID", clusterID, "planName", plan.Spec.Name)
			}
		} else {
			replicateSFPlanResourceData(&obj, plan)
			err = utils.SetOwnerReference(service, plan, r.scheme)
			if err != nil {
				return err
			}
			err = (*targetClient).Update(ctx, plan)
			if err != nil {
				log.Error(err, "Updating plan on sister cluster failed")
				return err
			}
			log.Info("Updated plan on cluster ", "clusterID", clusterID, "planName", plan.Spec.Name)
		}
	}
	return nil
}

func enqueueRequestForAllClusters(clusterRegistry registry.ClusterRegistry) []ctrl.Request {
	clusterList, err := clusterRegistry.ListClusters(nil)
	if err != nil {
		return nil
	}
	reconcileRequests := make([]ctrl.Request, len(clusterList.Items))
	for i, cluster := range clusterList.Items {
		reconcileRequests[i] = ctrl.Request{
			NamespacedName: types.NamespacedName{
				Name:      cluster.GetName(),
				Namespace: cluster.GetNamespace(),
			},
		}
	}
	return reconcileRequests
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

// SetupWithManager registers the MCD Services Controller with manager
// and setups the watches.
func (r *ReconcileSFServices) SetupWithManager(mgr ctrl.Manager) error {
	r.scheme = mgr.GetScheme()

	if r.Log == nil {
		r.Log = ctrl.Log.WithName("mcd").WithName("replicator").WithName("service")
	}
	if r.clusterRegistry == nil {
		clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
		if err != nil {
			return err
		}
		r.clusterRegistry = clusterRegistry
	}

	// Define a mapping from the object in the event(sfservice/sfplan) to
	// list of sfclusters to reconcile
	mapFn := handler.ToRequestsFunc(
		func(a handler.MapObject) []ctrl.Request {
			return enqueueRequestForAllClusters(r.clusterRegistry)
		})

	builder := ctrl.NewControllerManagedBy(mgr).
		Named("mcd_replicator_service").
		For(&resourcev1alpha1.SFCluster{}).
		Watches(&source.Kind{Type: &osbv1alpha1.SFService{}}, &handler.EnqueueRequestsFromMapFunc{
			ToRequests: mapFn,
		}).
		Watches(&source.Kind{Type: &osbv1alpha1.SFPlan{}}, &handler.EnqueueRequestsFromMapFunc{
			ToRequests: mapFn,
		}).
		WithEventFilter(watches.NamespaceFilter())

	return builder.Complete(r)
}
