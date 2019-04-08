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

package sfservicebinding

import (
	"context"
	"fmt"
	"reflect"
	"strconv"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	clusterFactory "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/cluster/factory"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/properties"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/resources"

	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var log = logf.Log.WithName("binding.controller")

// Add creates a new SFServiceBinding Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
func Add(mgr manager.Manager) error {
	clusterFactory, err := clusterFactory.New(mgr)
	if err != nil {
		return err
	}

	return add(mgr, newReconciler(mgr, resources.New(), clusterFactory))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager, resourceManager resources.ResourceManager, clusterFactory clusterFactory.ClusterFactory) reconcile.Reconciler {
	return &ReconcileSFServiceBinding{
		Client:          mgr.GetClient(),
		scheme:          mgr.GetScheme(),
		clusterFactory:  clusterFactory,
		resourceManager: resourceManager,
	}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	cfgManager, err := config.New(mgr.GetConfig())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	// Create a new controller
	c, err := controller.New("sfservicebinding-controller", mgr, controller.Options{
		Reconciler:              r,
		MaxConcurrentReconciles: interoperatorCfg.BindingWorkerCount,
	})
	if err != nil {
		return err
	}

	// Watch for changes to SFServiceBinding
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.SFServiceBinding{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	// TODO dynamically setup rbac rules and watches
	subresources := make([]runtime.Object, len(interoperatorCfg.BindingContollerWatchList))
	for i, gvk := range interoperatorCfg.BindingContollerWatchList {
		object := &unstructured.Unstructured{}
		object.SetKind(gvk.GetKind())
		object.SetAPIVersion(gvk.GetAPIVersion())
		subresources[i] = object
	}

	for _, subresource := range subresources {
		err = c.Watch(&source.Kind{Type: subresource}, &handler.EnqueueRequestForOwner{
			IsController: true,
			OwnerType:    &osbv1alpha1.SFServiceBinding{},
		})
		if err != nil {
			log.Error(err, "failed to start watch")
		}
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileSFServiceBinding{}

// ReconcileSFServiceBinding reconciles a SFServiceBinding object
type ReconcileSFServiceBinding struct {
	client.Client
	scheme          *runtime.Scheme
	clusterFactory  clusterFactory.ClusterFactory
	resourceManager resources.ResourceManager
}

// Reconcile reads that state of the cluster for a SFServiceBinding object and makes changes based on the state read
// and what is in the SFServiceBinding.Spec
// Automatically generate RBAC rules to allow the Controller to read and write Deployments
// +kubebuilder:rbac:groups=bind.servicefabrik.io,resources=*,verbs=*
// TODO dynamically setup rbac rules and watches
func (r *ReconcileSFServiceBinding) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the SFServiceBinding instance
	binding := &osbv1alpha1.SFServiceBinding{}
	err := r.Get(context.TODO(), request.NamespacedName, binding)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			log.Info("binding deleted", "binding", request.NamespacedName.Name)
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return r.handleError(binding, reconcile.Result{}, err, "", 0)
	}

	serviceID := binding.Spec.ServiceID
	planID := binding.Spec.PlanID
	instanceID := binding.Spec.InstanceID
	bindingID := binding.GetName()
	state := binding.GetState()
	labels := binding.GetLabels()
	lastOperation, ok := labels[constants.LastOperationKey]
	if !ok {
		lastOperation = "in_queue"
	}

	if err := r.reconcileFinalizers(binding, 0); err != nil {
		return r.handleError(binding, reconcile.Result{Requeue: true}, nil, "", 0)
	}

	targetClient, err := r.clusterFactory.GetCluster(instanceID, bindingID, serviceID, planID)
	if err != nil {
		return r.handleError(binding, reconcile.Result{}, err, "", 0)
	}

	if state == "delete" && !binding.GetDeletionTimestamp().IsZero() {
		// The object is being deleted
		// so lets handle our external dependency
		// Explicitly delete BindSecret
		secretName := "sf-" + bindingID
		bindSecret := osbv1alpha1.Source{}
		bindSecret.Kind = "Secret"
		bindSecret.APIVersion = "v1"
		bindSecret.Name = secretName
		bindSecret.Namespace = binding.GetNamespace()
		resourceRefs := append(binding.Status.Resources, bindSecret)
		remainingResource, err := r.resourceManager.DeleteSubResources(targetClient, resourceRefs)
		if err != nil {
			log.Error(err, "Delete sub resources failed", "binding", bindingID)
			return r.handleError(binding, reconcile.Result{}, err, state, 0)
		}
		err = r.setInProgress(request.NamespacedName, state, remainingResource, 0)
		if err != nil {
			return r.handleError(binding, reconcile.Result{}, err, state, 0)
		}
		lastOperation = state
	} else if state == "in_queue" || state == "update" {
		expectedResources, err := r.resourceManager.ComputeExpectedResources(r, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, binding.GetNamespace())
		if err != nil {
			return r.handleError(binding, reconcile.Result{}, err, state, 0)
		}
		err = r.resourceManager.SetOwnerReference(binding, expectedResources, r.scheme)
		if err != nil {
			return r.handleError(binding, reconcile.Result{}, err, state, 0)
		}

		resourceRefs, err := r.resourceManager.ReconcileResources(r, targetClient, expectedResources, binding.Status.Resources)
		if err != nil {
			log.Error(err, "ReconcileResources failed", "binding", bindingID)
			return r.handleError(binding, reconcile.Result{}, err, state, 0)
		}
		err = r.setInProgress(request.NamespacedName, state, resourceRefs, 0)
		if err != nil {
			return r.handleError(binding, reconcile.Result{}, err, state, 0)
		}
		lastOperation = state
	}

	err = r.Get(context.TODO(), request.NamespacedName, binding)
	if err != nil {
		return r.handleError(binding, reconcile.Result{}, err, "", 0)
	}
	state = binding.GetState()
	labels = binding.GetLabels()
	lastOperation, ok = labels[constants.LastOperationKey]
	if !ok {
		lastOperation = "in_queue"
	}

	if state == "in progress" {
		if lastOperation == "delete" {
			if err := r.updateUnbindStatus(targetClient, binding, 0); err != nil {
				return r.handleError(binding, reconcile.Result{}, err, lastOperation, 0)
			}
		} else if lastOperation == "in_queue" || lastOperation == "update" {
			err = r.updateBindStatus(targetClient, binding, 0)
			if err != nil {
				return r.handleError(binding, reconcile.Result{}, err, lastOperation, 0)
			}
		}
	}
	return r.handleError(binding, reconcile.Result{}, nil, lastOperation, 0)
}

func (r *ReconcileSFServiceBinding) reconcileFinalizers(object *osbv1alpha1.SFServiceBinding, retryCount int) error {
	objectID := object.GetName()
	namespace := object.GetNamespace()
	// Fetch object again before updating
	namespacedName := types.NamespacedName{
		Name:      objectID,
		Namespace: namespace,
	}
	err := r.Get(context.TODO(), namespacedName, object)
	if err != nil {
		if retryCount < constants.ErrorThreshold {
			log.Info("Retrying", "function", "reconcileFinalizers", "retryCount", retryCount+1, "objectID", objectID)
			return r.reconcileFinalizers(object, retryCount+1)
		}
		log.Error(err, "failed to fetch object", "objectID", objectID)
		return err
	}
	if object.GetDeletionTimestamp().IsZero() {
		if !containsString(object.GetFinalizers(), constants.FinalizerName) {
			// The object is not being deleted, so if it does not have our finalizer,
			// then lets add the finalizer and update the object.
			object.SetFinalizers(append(object.GetFinalizers(), constants.FinalizerName))
			if err := r.Update(context.Background(), object); err != nil {
				if retryCount < constants.ErrorThreshold {
					log.Info("Retrying", "function", "reconcileFinalizers", "retryCount", retryCount+1, "objectID", objectID)
					return r.reconcileFinalizers(object, retryCount+1)
				}
				log.Error(err, "failed to add finalizer", "objectID", objectID)
				return err
			}
			log.Info("added finalizer", "objectID", objectID)
		}
	}
	return nil
}

func (r *ReconcileSFServiceBinding) setInProgress(namespacedName types.NamespacedName, state string, resources []osbv1alpha1.Source, retryCount int) error {
	if state == "in_queue" || state == "update" || state == "delete" {
		binding := &osbv1alpha1.SFServiceBinding{}
		err := r.Get(context.TODO(), namespacedName, binding)
		if err != nil {
			if retryCount < constants.ErrorThreshold {
				log.Info("Retrying", "function", "setInProgress", "retryCount", retryCount+1, "objectID", namespacedName.Name)
				return r.setInProgress(namespacedName, state, resources, retryCount+1)
			}
			log.Error(err, "Updating status to in progress failed", "binding", namespacedName.Name)
			return err
		}
		binding.SetState("in progress")
		labels := binding.GetLabels()
		if labels == nil {
			labels = make(map[string]string)
		}
		labels[constants.LastOperationKey] = state
		binding.SetLabels(labels)
		binding.Status.Resources = resources
		err = r.Update(context.Background(), binding)
		if err != nil {
			if retryCount < constants.ErrorThreshold {
				log.Info("Retrying", "function", "setInProgress", "retryCount", retryCount+1, "objectID", namespacedName.Name)
				return r.setInProgress(namespacedName, state, resources, retryCount+1)
			}
			log.Error(err, "Updating status to in progress failed", "binding", namespacedName.Name)
			return err
		}
		log.Info("Updated status to in progress", "operation", state, "binding", namespacedName.Name)
	}
	return nil
}

func (r *ReconcileSFServiceBinding) updateUnbindStatus(targetClient client.Client, binding *osbv1alpha1.SFServiceBinding, retryCount int) error {
	serviceID := binding.Spec.ServiceID
	planID := binding.Spec.PlanID
	instanceID := binding.Spec.InstanceID
	bindingID := binding.GetName()
	namespace := binding.GetNamespace()
	computedStatus, err := r.resourceManager.ComputeStatus(r, targetClient, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, namespace)
	if err != nil && !errors.NotFound(err) {
		log.Error(err, "ComputeStatus failed for unbind", "binding", bindingID)
		return err
	}

	if errors.NotFound(err) && computedStatus == nil {
		computedStatus = &properties.Status{}
		computedStatus.Unbind.State = binding.GetState()
		computedStatus.Unbind.Error = err.Error()
	}

	// Fetch object again before updating status
	namespacedName := types.NamespacedName{
		Name:      bindingID,
		Namespace: namespace,
	}
	err = r.Get(context.TODO(), namespacedName, binding)
	if err != nil {
		log.Error(err, "Failed to get binding", "binding", bindingID)
		return err
	}

	updateRequired := false
	updatedStatus := binding.Status.DeepCopy()
	updatedStatus.State = computedStatus.Unbind.State
	updatedStatus.Error = computedStatus.Unbind.Error

	remainingResource := []osbv1alpha1.Source{}
	for _, subResource := range binding.Status.Resources {
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
		if !apiErrors.IsNotFound(err) {
			remainingResource = append(remainingResource, subResource)
		}
	}
	updatedStatus.Resources = remainingResource
	if !reflect.DeepEqual(&binding.Status, updatedStatus) {
		updatedStatus.DeepCopyInto(&binding.Status)
		updateRequired = true
	}

	if binding.GetState() == "succeeded" || len(remainingResource) == 0 {
		// remove our finalizer from the list and update it.
		log.Info("Removing finalizer", "binding", bindingID)
		binding.SetFinalizers(removeString(binding.GetFinalizers(), constants.FinalizerName))
		binding.SetState("succeeded")
		updateRequired = true
	}

	if updateRequired {
		log.Info("Updating unbind status from template", "binding", namespacedName.Name)
		if err := r.Update(context.Background(), binding); err != nil {
			if retryCount < constants.ErrorThreshold {
				log.Info("Retrying", "function", "updateUnbindStatus", "retryCount", retryCount+1, "bindingID", bindingID)
				return r.updateUnbindStatus(targetClient, binding, retryCount+1)
			}
			log.Error(err, "failed to update unbind status", "binding", bindingID)
			return err
		}
	}
	return nil
}

func (r *ReconcileSFServiceBinding) updateBindStatus(targetClient client.Client, binding *osbv1alpha1.SFServiceBinding, retryCount int) error {
	serviceID := binding.Spec.ServiceID
	planID := binding.Spec.PlanID
	instanceID := binding.Spec.InstanceID
	bindingID := binding.GetName()
	namespace := binding.GetNamespace()
	computedStatus, err := r.resourceManager.ComputeStatus(r, targetClient, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, namespace)
	if err != nil {
		log.Error(err, "Compute status failed for bind", "binding", bindingID)
		return err
	}

	// Fetch object again before updating status
	namespacedName := types.NamespacedName{
		Name:      bindingID,
		Namespace: namespace,
	}
	err = r.Get(context.TODO(), namespacedName, binding)
	if err != nil {
		log.Error(err, "failed to fetch binding", "binding", bindingID)
		return err
	}

	updatedStatus := binding.Status.DeepCopy()
	updatedStatus.State = computedStatus.Bind.State
	updatedStatus.Error = computedStatus.Bind.Error

	computedBindingStatus := computedStatus.Bind

	// Create secret if not exist
	if computedBindingStatus.State == "succeeded" {
		secretName := "sf-" + bindingID

		data := make(map[string]string)
		data["response"] = computedBindingStatus.Response
		secret := &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{
				Name:      secretName,
				Namespace: namespace,
			},
			StringData: data,
		}

		if err := controllerutil.SetControllerReference(binding, secret, r.scheme); err != nil {
			log.Error(err, "failed to set owner reference for secret", "binding", bindingID)
			return err
		}
		secretNamespacedName := types.NamespacedName{
			Name:      secretName,
			Namespace: namespace,
		}
		foundSecret := &corev1.Secret{}
		err = r.Get(context.TODO(), secretNamespacedName, foundSecret)
		if err != nil && apiErrors.IsNotFound(err) {
			err = r.Create(context.TODO(), secret)
			if err != nil {
				log.Error(err, "failed to create secret", "binding", bindingID)
				return err
			}
		} else if err != nil {
			return err
		}
		updatedStatus.Response.SecretRef = secretName
	}

	if !reflect.DeepEqual(&binding.Status, updatedStatus) {
		updatedStatus.DeepCopyInto(&binding.Status)
		log.Info("Updating bind status from template", "binding", namespacedName.Name)
		err = r.Update(context.Background(), binding)
		if err != nil {
			if retryCount < constants.ErrorThreshold {
				log.Info("Retrying", "function", "updateBindStatus", "retryCount", retryCount+1, "bindingID", bindingID)
				return r.updateBindStatus(targetClient, binding, retryCount+1)
			}
			log.Error(err, "failed to update status", "binding", bindingID)
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

func (r *ReconcileSFServiceBinding) handleError(object *osbv1alpha1.SFServiceBinding, result reconcile.Result, inputErr error, lastOperation string, retryCount int) (reconcile.Result, error) {
	objectID := object.GetName()
	namespace := object.GetNamespace()
	// Fetch object again before updating
	namespacedName := types.NamespacedName{
		Name:      objectID,
		Namespace: namespace,
	}
	err := r.Get(context.TODO(), namespacedName, object)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			return result, inputErr
		}
		if retryCount < constants.ErrorThreshold {
			log.Info("Retrying", "function", "handleError", "retryCount", retryCount+1, "lastOperation", lastOperation, "err", inputErr, "objectID", objectID)
			return r.handleError(object, result, inputErr, lastOperation, retryCount+1)
		}
		log.Error(err, "failed to fetch object", "objectID", objectID)
		return result, inputErr
	}

	if errors.SFServiceInstanceNotFound(inputErr) {
		log.Info("sfserviceinstance not found for binding. deleting.", "objectID", objectID, "InstanceID", object.Spec.InstanceID)
		err = r.Delete(context.TODO(), object)
		if err != nil && retryCount < constants.ErrorThreshold {
			log.Info("Retrying", "function", "handleError", "retryCount", retryCount+1, "lastOperation", lastOperation, "err", inputErr, "objectID", objectID)
			return r.handleError(object, result, inputErr, lastOperation, retryCount+1)
		} else if err == nil {
			object.SetState("delete")
			err = r.Update(context.TODO(), object)
			if err != nil && retryCount < constants.ErrorThreshold {
				log.Info("Retrying", "function", "handleError", "retryCount", retryCount+1, "lastOperation", lastOperation, "err", inputErr, "objectID", objectID)
				return r.handleError(object, result, inputErr, lastOperation, retryCount+1)
			} else if err == nil {
				return result, nil
			}
		}
	}

	labels := object.GetLabels()
	var count int64

	if labels == nil {
		labels = make(map[string]string)
	}

	countString, ok := labels[constants.ErrorCountKey]
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

	if count > constants.ErrorThreshold {
		log.Error(inputErr, "Retry threshold reached. Ignoring error", "objectID", objectID)
		object.Status.State = "failed"
		object.Status.Error = fmt.Sprintf("Retry threshold reached for %s.\n%s", objectID, inputErr.Error())
		if lastOperation != "" {
			labels[constants.LastOperationKey] = lastOperation
			object.SetLabels(labels)
		}
		err := r.Update(context.TODO(), object)
		if err != nil {
			if retryCount < constants.ErrorThreshold {
				log.Info("Retrying", "function", "handleError", "retryCount", retryCount+1, "lastOperation", lastOperation, "err", inputErr, "objectID", objectID)
				return r.handleError(object, result, inputErr, lastOperation, retryCount+1)
			}
			log.Error(err, "Failed to set state to failed", "objectID", objectID)
		}
		return result, nil
	}

	labels[constants.ErrorCountKey] = strconv.FormatInt(count, 10)
	object.SetLabels(labels)
	err = r.Update(context.TODO(), object)
	if err != nil {
		if retryCount < constants.ErrorThreshold {
			log.Info("Retrying", "function", "handleError", "retryCount", retryCount+1, "lastOperation", lastOperation, "err", inputErr, "objectID", objectID)
			return r.handleError(object, result, inputErr, lastOperation, retryCount+1)
		}
		log.Error(err, "Failed to update error count label", "objectID", objectID, "count", count)
	}
	return result, inputErr
}
