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

package sfserviceinstance

import (
	"context"
	"fmt"
	"log"
	"reflect"
	"strconv"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	clusterFactory "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/cluster/factory"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/resources"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

// finalizerName is the name of the finalizer added by interoperator
const (
	finalizerName    = "interoperator.servicefabrik.io"
	errorCountKey    = "interoperator.servicefabrik.io/error"
	lastOperationKey = "interoperator.servicefabrik.io/lastoperation"
	errorThreshold   = 10
)

// Add creates a new ServiceInstance Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
func Add(mgr manager.Manager) error {
	clusterFactory, _ := clusterFactory.New(mgr)
	return add(mgr, newReconciler(mgr, resources.New(), clusterFactory))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager, resourceManager resources.ResourceManager, clusterFactory clusterFactory.ClusterFactory) reconcile.Reconciler {
	return &ReconcileServiceInstance{
		Client:          mgr.GetClient(),
		scheme:          mgr.GetScheme(),
		clusterFactory:  clusterFactory,
		resourceManager: resourceManager,
	}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	// Create a new controller
	c, err := controller.New("serviceinstance-controller", mgr, controller.Options{Reconciler: r})
	if err != nil {
		return err
	}

	// Watch for changes to ServiceInstance
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.SFServiceInstance{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	// TODO dynamically setup rbac rules and watches
	postgres := &unstructured.Unstructured{}
	postgres.SetKind("Postgres")
	postgres.SetAPIVersion("kubedb.com/v1alpha1")
	postgres2 := &unstructured.Unstructured{}
	postgres2.SetKind("Postgresql")
	postgres2.SetAPIVersion("kubernetes.sapcloud.io/v1alpha1")
	director := &unstructured.Unstructured{}
	director.SetKind("Director")
	director.SetAPIVersion("deployment.servicefabrik.io/v1alpha1")
	docker := &unstructured.Unstructured{}
	docker.SetKind("Docker")
	docker.SetAPIVersion("deployment.servicefabrik.io/v1alpha1")
	postgresqlmts := &unstructured.Unstructured{}
	postgresqlmts.SetKind("PostgresqlMT")
	postgresqlmts.SetAPIVersion("deployment.servicefabrik.io/v1alpha1")
	vhostmts := &unstructured.Unstructured{}
	vhostmts.SetKind("VirtualHost")
	vhostmts.SetAPIVersion("deployment.servicefabrik.io/v1alpha1")
	subresources := []runtime.Object{
		&appsv1.Deployment{},
		&corev1.ConfigMap{},
		postgres,
		postgres2,
		director,
		docker,
		postgresqlmts,
		vhostmts,
	}

	for _, subresource := range subresources {
		err = c.Watch(&source.Kind{Type: subresource}, &handler.EnqueueRequestForOwner{
			IsController: true,
			OwnerType:    &osbv1alpha1.SFServiceInstance{},
		})
		if err != nil {
			log.Printf("%v", err)
		}
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileServiceInstance{}

// ReconcileServiceInstance reconciles a ServiceInstance object
type ReconcileServiceInstance struct {
	client.Client
	scheme          *runtime.Scheme
	clusterFactory  clusterFactory.ClusterFactory
	resourceManager resources.ResourceManager
}

// Reconcile reads that state of the cluster for a ServiceInstance object and makes changes based on the state read
// and what is in the ServiceInstance.Spec
// Automatically generate RBAC rules to allow the Controller to read and write Deployments
// +kubebuilder:rbac:groups=kubedb.com,resources=Postgres,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=kubernetes.sapcloud.io,resources=postgresql,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=deployment.servicefabrik.io,resources=director,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=deployment.servicefabrik.io,resources=docker,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=deployment.servicefabrik.io,resources=postgresqlmt,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=deployment.servicefabrik.io,resources=virtualhost,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=,resources=configmap,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=interoperator.servicefabrik.io,resources=sfserviceinstances,verbs=get;list;watch;create;update;patch;delete
// TODO dynamically setup rbac rules and watches
func (r *ReconcileServiceInstance) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the ServiceInstance instance
	instance := &osbv1alpha1.SFServiceInstance{}
	err := r.Get(context.TODO(), request.NamespacedName, instance)
	if err != nil {
		if errors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			log.Printf("instance %s deleted\n", request.NamespacedName)
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return r.handleError(instance, reconcile.Result{}, err)
	}

	serviceID := instance.Spec.ServiceID
	planID := instance.Spec.PlanID
	instanceID := instance.GetName()
	bindingID := ""
	state := instance.GetState()
	labels := instance.GetLabels()
	lastOperation, ok := labels[lastOperationKey]
	if !ok {
		lastOperation = "in_queue"
	}
	var requeue bool
	var appliedResources []*unstructured.Unstructured
	var remainingResource []osbv1alpha1.Source

	if instance.GetDeletionTimestamp().IsZero() {
		if !containsString(instance.GetFinalizers(), finalizerName) {
			// The object is not being deleted, so if it does not have our finalizer,
			// then lets add the finalizer and update the object.
			instance.SetFinalizers(append(instance.GetFinalizers(), finalizerName))
			if err := r.Update(context.Background(), instance); err != nil {
				return r.handleError(instance, reconcile.Result{Requeue: true}, nil)
			}
		}
	}

	targetClient, err := r.clusterFactory.GetCluster(instanceID, bindingID, serviceID, planID)
	if err != nil {
		return r.handleError(instance, reconcile.Result{}, err)
	}

	if state == "delete" && !instance.GetDeletionTimestamp().IsZero() {
		// The object is being deleted
		if containsString(instance.GetFinalizers(), finalizerName) {
			// our finalizer is present, so lets handle our external dependency
			remainingResource, err = r.resourceManager.DeleteSubResources(targetClient, instance.Status.Resources)
			if err != nil {
				log.Printf("Delete sub resources error %s\n", err.Error())
				requeue = true
			} else {
				err = r.setInProgress(request.NamespacedName, state)
				if err != nil {
					requeue = true
				} else {
					lastOperation = state
				}
			}
		}
	} else if state == "in_queue" || state == "update" {
		expectedResources, err := r.resourceManager.ComputeExpectedResources(r, instanceID, bindingID, serviceID, planID, osbv1alpha1.ProvisionAction, instance.GetNamespace())
		if err != nil {
			return r.handleError(instance, reconcile.Result{}, err)
		}

		err = r.resourceManager.SetOwnerReference(instance, expectedResources, r.scheme)
		if err != nil {
			return r.handleError(instance, reconcile.Result{}, err)
		}

		appliedResources, err = r.resourceManager.ReconcileResources(r, targetClient, expectedResources, instance.Status.Resources)
		if err != nil {
			log.Printf("Reconcile error %s\n", err.Error())
			requeue = true
		} else {
			err = r.setInProgress(request.NamespacedName, state)
			if err != nil {
				requeue = true
			} else {
				lastOperation = state
			}
		}
	}

	if lastOperation == "delete" {
		remainingResource = []osbv1alpha1.Source{}
		for _, subResource := range instance.Status.Resources {
			resource := &unstructured.Unstructured{}
			resource.SetKind(subResource.Kind)
			resource.SetAPIVersion(subResource.APIVersion)
			resource.SetName(subResource.Name)
			resource.SetNamespace(subResource.Namespace)
			namespacedName := types.NamespacedName{
				Name:      resource.GetName(),
				Namespace: resource.GetNamespace(),
			}
			err := targetClient.Get(context.TODO(), namespacedName, resource)
			if !errors.IsNotFound(err) {
				remainingResource = append(remainingResource, subResource)
			}
		}
		if err := r.updateDeprovisionStatus(targetClient, instance, remainingResource); err != nil {
			return r.handleError(instance, reconcile.Result{}, err)
		}
	} else if lastOperation == "in_queue" || lastOperation == "update" {
		err = r.updateStatus(instanceID, bindingID, serviceID, planID, instance.GetNamespace(), appliedResources)
		if err != nil {
			return r.handleError(instance, reconcile.Result{}, err)
		}
	}
	return r.handleError(instance, reconcile.Result{Requeue: requeue}, nil)
}

func (r *ReconcileServiceInstance) setInProgress(namespacedName types.NamespacedName, state string) error {
	if state == "in_queue" || state == "update" || state == "delete" {
		instance := &osbv1alpha1.SFServiceInstance{}
		err := r.Get(context.TODO(), namespacedName, instance)
		if err != nil {
			log.Printf("error updating status to in progress. %s\n", err.Error())
			return err
		}
		instance.SetState("in progress")
		labels := instance.GetLabels()
		if labels == nil {
			labels = make(map[string]string)
		}
		labels[lastOperationKey] = state
		instance.SetLabels(labels)
		err = r.Update(context.Background(), instance)
		if err != nil {
			log.Printf("error updating status to in progress. %s\n", err.Error())
			return err
		}
		log.Printf("Updated status to in progress for operation %s\n", state)
	}
	return nil
}

func (r *ReconcileServiceInstance) updateDeprovisionStatus(targetClient client.Client, instance *osbv1alpha1.SFServiceInstance, remainingResource []osbv1alpha1.Source) error {
	serviceID := instance.Spec.ServiceID
	planID := instance.Spec.PlanID
	instanceID := instance.GetName()
	bindingID := ""
	namespace := instance.GetNamespace()
	computedStatus, err := r.resourceManager.ComputeStatus(r, targetClient, instanceID, bindingID, serviceID, planID, osbv1alpha1.ProvisionAction, namespace)
	if err != nil {
		log.Printf("error computing status. %v\n", err)
		return err
	}

	// Fetch object again before updating status
	instanceObj := &osbv1alpha1.SFServiceInstance{}
	namespacedName := types.NamespacedName{
		Name:      instanceID,
		Namespace: namespace,
	}
	err = r.Get(context.TODO(), namespacedName, instanceObj)
	if err != nil {
		log.Printf("error fetching instance. %v\n", err.Error())
		return err
	}

	updateRequired := false
	updatedStatus := instance.Status.DeepCopy()
	updatedStatus.State = computedStatus.Deprovision.State
	updatedStatus.Error = computedStatus.Deprovision.Error
	updatedStatus.Description = computedStatus.Deprovision.Response
	updatedStatus.Resources = remainingResource
	if !reflect.DeepEqual(&instance.Status, updatedStatus) {
		updatedStatus.DeepCopyInto(&instance.Status)
		updateRequired = true
	}

	if instance.Status.State == "succeeded" || len(remainingResource) == 0 {
		// remove our finalizer from the list and update it.
		log.Printf("instance %s removing finalizer\n", instanceID)
		instance.SetFinalizers(removeString(instance.GetFinalizers(), finalizerName))
		updateRequired = true
	}

	if updateRequired {
		if err := r.Update(context.Background(), instance); err != nil {
			log.Printf("error updating deprovision status instance %s. %s.\n", instanceID, err.Error())
			return err
		}
	}
	return nil
}

func (r *ReconcileServiceInstance) updateStatus(instanceID, bindingID, serviceID, planID, namespace string, appliedResources []*unstructured.Unstructured) error {
	targetClient, err := r.clusterFactory.GetCluster(instanceID, bindingID, serviceID, planID)
	if err != nil {
		return err
	}

	resourceRefs := make([]osbv1alpha1.Source, 0, len(appliedResources))
	for _, appliedResource := range appliedResources {
		resource := osbv1alpha1.Source{}
		resource.Kind = appliedResource.GetKind()
		resource.APIVersion = appliedResource.GetAPIVersion()
		resource.Name = appliedResource.GetName()
		resource.Namespace = appliedResource.GetNamespace()
		resourceRefs = append(resourceRefs, resource)
	}

	computedStatus, err := r.resourceManager.ComputeStatus(r, targetClient, instanceID, bindingID, serviceID, planID, osbv1alpha1.ProvisionAction, namespace)
	if err != nil {
		log.Printf("error computing status. %v\n", err)
		return err
	}

	// Fetch object again before updating status
	instanceObj := &osbv1alpha1.SFServiceInstance{}
	namespacedName := types.NamespacedName{
		Name:      instanceID,
		Namespace: namespace,
	}
	err = r.Get(context.TODO(), namespacedName, instanceObj)
	if err != nil {
		log.Printf("error fetching instance. %v\n", err)
		return err
	}
	updatedStatus := instanceObj.Status.DeepCopy()
	updatedStatus.State = computedStatus.Provision.State
	updatedStatus.Error = computedStatus.Provision.Error
	updatedStatus.Description = computedStatus.Provision.Response
	updatedStatus.DashboardURL = computedStatus.Provision.DashboardURL
	if appliedResources != nil {
		updatedStatus.Resources = resourceRefs
	}
	if !reflect.DeepEqual(&instanceObj.Status, updatedStatus) {
		updatedStatus.DeepCopyInto(&instanceObj.Status)
		log.Printf("Updating provision status from template for %s\n", namespacedName)
		err = r.Update(context.Background(), instanceObj)
		if err != nil {
			log.Printf("error updating status. %v\n", err)
			return err
		}
	}

	return nil
}

//
// Helper functions to check and remove string from a slice of strings.
//
func containsString(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}

func removeString(slice []string, s string) (result []string) {
	for _, item := range slice {
		if item == s {
			continue
		}
		result = append(result, item)
	}
	return
}

func (r *ReconcileServiceInstance) handleError(object *osbv1alpha1.SFServiceInstance, result reconcile.Result, inputErr error) (reconcile.Result, error) {
	labels := object.GetLabels()
	var count int64
	id := object.GetName()

	if labels == nil {
		labels = make(map[string]string)
	}

	countString, ok := labels[errorCountKey]
	if !ok {
		count = 0
	} else {
		i, err := strconv.ParseInt(countString, 10, 64)
		if err != nil {
			count = 0
		} else {
			count = i
		}
	}

	if inputErr == nil {
		if count == 0 {
			//No change for count
			return result, inputErr
		}
		count = 0
	} else {
		count++
	}

	if count > errorThreshold {
		log.Printf("Retry threshold reached for %s. Ignoring %v\n", id, inputErr)
		object.Status.State = "failed"
		object.Status.Error = fmt.Sprintf("Retry threshold reached for %s.\n%s", id, inputErr.Error())
		object.Status.Description = "Service Broker Error: Something unexpected happened"
		err := r.Update(context.TODO(), object)
		if err != nil {
			log.Printf("Error setting state to failed for %s\n", id)
		}
		return result, nil
	}

	labels[errorCountKey] = strconv.FormatInt(count, 10)
	object.SetLabels(labels)
	err := r.Update(context.TODO(), object)
	if err != nil {
		if errors.IsConflict(err) {
			err := r.Get(context.TODO(), types.NamespacedName{
				Name:      object.GetName(),
				Namespace: object.GetNamespace(),
			}, object)
			if err != nil {
				return result, inputErr
			}
			labels = object.GetLabels()
			if labels == nil {
				labels = make(map[string]string)
			}
			labels[errorCountKey] = strconv.FormatInt(count, 10)
			object.SetLabels(labels)
			return r.handleError(object, result, inputErr)
		}
		log.Printf("Error Updating error count label to %d for instance %s\n", count, id)
	}
	return result, inputErr
}
