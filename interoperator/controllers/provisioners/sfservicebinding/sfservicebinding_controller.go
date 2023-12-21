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
	"os"
	"reflect"
	"strconv"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/properties"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/resources"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/handler"
)

// ReconcileSFServiceBinding reconciles a SFServiceBinding object
type ReconcileSFServiceBinding struct {
	client.Client
	Log             logr.Logger
	clusterRegistry registry.ClusterRegistry
	resourceManager resources.ResourceManager
	watchList       []osbv1alpha1.APIVersionKind
	cfgManager      config.Config
}

// Reconcile reads that state of the cluster for a SFServiceBinding object and makes changes based on the state read
// and what is in the SFServiceBinding.Spec
// Automatically generate RBAC rules to allow the Controller to read and write Deployments
// +kubebuilder:rbac:groups=bind.servicefabrik.io,resources=*,verbs=*
// TODO dynamically setup rbac rules and watches
func (r *ReconcileSFServiceBinding) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("sfservicebinding", req.NamespacedName)

	defer r.restartOnWatchUpdate()

	// Fetch the SFServiceBinding instance
	binding := &osbv1alpha1.SFServiceBinding{}
	err := r.Get(ctx, req.NamespacedName, binding)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			log.Info("binding deleted", "binding", req.NamespacedName.Name)
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return r.handleError(binding, ctrl.Result{}, err, "", 0)
	}

	serviceID := binding.Spec.ServiceID
	planID := binding.Spec.PlanID
	instanceID := binding.Spec.InstanceID
	bindingID := binding.GetName()
	state := binding.GetState()
	if state == "succeeded" || state == "failed" {
		return ctrl.Result{}, nil
	}

	if state == "in_queue" || state == "update" || state == "delete" || state == "in progress" {
		clusterID, err := binding.GetClusterID(r)
		if err != nil {
			if errors.SFServiceInstanceNotFound(err) || errors.ClusterIDNotSet(err) {
				if state != "delete" && state != "in progress" {
					return r.handleError(binding, ctrl.Result{}, err, state, 0)
				}
				log.Error(err, "failed to get clusterID. Proceding",
					"instanceID", instanceID, "bindingID", bindingID, "state", state)
				clusterID = constants.OwnClusterID

			} else {
				log.Error(err, "failed to get clusterID", "instance", instanceID, "bindingID", bindingID)
				return r.handleError(binding, ctrl.Result{}, err, state, 0)
			}
		}
		if clusterID != constants.OwnClusterID {
			return ctrl.Result{}, nil
		}
	}

	if err := r.reconcileFinalizers(binding, 0); err != nil {
		return r.handleError(binding, ctrl.Result{Requeue: true}, nil, "", 0)
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
		var resourceRefs []osbv1alpha1.Source

		expectedResources, err := r.resourceManager.ComputeExpectedResources(r, instanceID, bindingID, serviceID, planID, osbv1alpha1.UnbindAction, binding.GetNamespace())
		if err != nil && !errors.TemplateNotFound(err) {
			return r.handleError(binding, ctrl.Result{}, err, state, 0)
		}

		if err != nil {
			// Unbind Template is not present, delete all resources created
			resourceRefs = append(binding.Status.Resources, bindSecret)
		} else {
			_, err = r.resourceManager.ReconcileResources(r, expectedResources, binding.Status.Resources, true)
			if err != nil {
				log.Error(err, "ReconcileResources failed", "binding", bindingID)
				return r.handleError(binding, ctrl.Result{}, err, state, 0)
			}

			// Unbind template is present, delete only secret
			resourceRefs = []osbv1alpha1.Source{bindSecret}
		}

		remainingResource, err := r.resourceManager.DeleteSubResources(r, resourceRefs)
		if err != nil {
			log.Error(err, "Delete sub resources failed", "binding", bindingID)
			return r.handleError(binding, ctrl.Result{}, err, state, 0)
		}

		err = r.setInProgress(req.NamespacedName, state, remainingResource, 0)
		if err != nil {
			return r.handleError(binding, ctrl.Result{}, err, state, 0)
		}
	} else if state == "in_queue" || state == "update" {
		expectedResources, err := r.resourceManager.ComputeExpectedResources(r, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, binding.GetNamespace())
		if err != nil {
			return r.handleError(binding, ctrl.Result{}, err, state, 0)
		}
		err = r.resourceManager.SetOwnerReference(binding, expectedResources, r.Scheme())
		if err != nil {
			return r.handleError(binding, ctrl.Result{}, err, state, 0)
		}

		resourceRefs, err := r.resourceManager.ReconcileResources(r, expectedResources, binding.Status.Resources, false)
		if err != nil {
			log.Error(err, "ReconcileResources failed", "binding", bindingID)
			return r.handleError(binding, ctrl.Result{}, err, state, 0)
		}
		err = r.setInProgress(req.NamespacedName, state, resourceRefs, 0)
		if err != nil {
			return r.handleError(binding, ctrl.Result{}, err, state, 0)
		}
	}

	err = r.Get(ctx, req.NamespacedName, binding)
	if err != nil {
		return r.handleError(binding, ctrl.Result{}, err, "", 0)
	}
	state = binding.GetState()
	labels := binding.GetLabels()
	lastOperation, ok := labels[constants.LastOperationKey]
	if !ok {
		lastOperation = "in_queue"
	}

	if state == "in progress" {
		if lastOperation == "delete" {
			err = r.updateUnbindStatus(binding, 0)
			if err != nil {
				return r.handleError(binding, ctrl.Result{}, err, lastOperation, 0)
			}
		} else if lastOperation == "in_queue" || lastOperation == "update" {
			err = r.updateBindStatus(binding, 0)
			if err != nil {
				return r.handleError(binding, ctrl.Result{}, err, lastOperation, 0)
			}
		}
	}
	return r.handleError(binding, ctrl.Result{}, nil, lastOperation, 0)
}

func (r *ReconcileSFServiceBinding) reconcileFinalizers(object *osbv1alpha1.SFServiceBinding, retryCount int) error {
	ctx := context.Background()

	objectID := object.GetName()
	namespace := object.GetNamespace()
	// Fetch object again before updating
	namespacedName := types.NamespacedName{
		Name:      objectID,
		Namespace: namespace,
	}
	log := r.Log.WithValues("sfservicebinding", namespacedName)
	err := r.Get(ctx, namespacedName, object)
	if err != nil {
		if retryCount < constants.ErrorThreshold {
			log.Info("Retrying", "function", "reconcileFinalizers", "retryCount", retryCount+1, "objectID", objectID)
			return r.reconcileFinalizers(object, retryCount+1)
		}
		log.Error(err, "failed to fetch object", "objectID", objectID)
		return err
	}
	if object.GetDeletionTimestamp().IsZero() {
		if !utils.ContainsString(object.GetFinalizers(), constants.FinalizerName) {
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
	ctx := context.Background()
	log := r.Log.WithValues("sfservicebinding", namespacedName)

	if state == "in_queue" || state == "update" || state == "delete" {
		binding := &osbv1alpha1.SFServiceBinding{}
		err := r.Get(ctx, namespacedName, binding)
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

func (r *ReconcileSFServiceBinding) updateUnbindStatus(binding *osbv1alpha1.SFServiceBinding, retryCount int) error {
	ctx := context.Background()

	serviceID := binding.Spec.ServiceID
	planID := binding.Spec.PlanID
	instanceID := binding.Spec.InstanceID
	bindingID := binding.GetName()
	namespace := binding.GetNamespace()
	log := r.Log.WithValues("sfservicebinding", bindingID)

	computedStatus, err := r.resourceManager.ComputeStatus(r, instanceID, bindingID, serviceID, planID, osbv1alpha1.UnbindAction, namespace)
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
	err = r.Get(ctx, namespacedName, binding)
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
		err := r.Get(ctx, namespacedName, resource)
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
		binding.SetFinalizers(utils.RemoveString(binding.GetFinalizers(), constants.FinalizerName))
		binding.SetState("succeeded")
		updateRequired = true
	}

	if updateRequired {
		log.Info("Updating unbind status from template", "binding", namespacedName.Name)
		if err := r.Update(context.Background(), binding); err != nil {
			if retryCount < constants.ErrorThreshold {
				log.Info("Retrying", "function", "updateUnbindStatus", "retryCount", retryCount+1, "bindingID", bindingID)
				return r.updateUnbindStatus(binding, retryCount+1)
			}
			log.Error(err, "failed to update unbind status", "binding", bindingID)
			return err
		}
	}
	return nil
}

func (r *ReconcileSFServiceBinding) updateBindStatus(binding *osbv1alpha1.SFServiceBinding, retryCount int) error {
	ctx := context.Background()

	serviceID := binding.Spec.ServiceID
	planID := binding.Spec.PlanID
	instanceID := binding.Spec.InstanceID
	bindingID := binding.GetName()
	namespace := binding.GetNamespace()
	log := r.Log.WithValues("sfservicebinding", bindingID)

	computedStatus, err := r.resourceManager.ComputeStatus(r, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, namespace)
	if err != nil {
		log.Error(err, "Compute status failed for bind", "binding", bindingID)
		return err
	}

	// Fetch object again before updating status
	namespacedName := types.NamespacedName{
		Name:      bindingID,
		Namespace: namespace,
	}
	err = r.Get(ctx, namespacedName, binding)
	if err != nil {
		log.Error(err, "failed to fetch binding", "binding", bindingID)
		return err
	}

	updatedStatus := binding.Status.DeepCopy()
	updatedStatus.State = computedStatus.Bind.State
	updatedStatus.Error = computedStatus.Bind.Error

	computedBindingStatus := computedStatus.Bind

	// Create secret if not exist
	if computedBindingStatus.State == "succeeded" || computedBindingStatus.State == "failed" {
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

		if err := utils.SetOwnerReference(binding, secret, r.Scheme()); err != nil {
			log.Error(err, "failed to set owner reference for secret", "binding", bindingID)
			return err
		}
		secretNamespacedName := types.NamespacedName{
			Name:      secretName,
			Namespace: namespace,
		}
		foundSecret := &corev1.Secret{}
		err = r.Get(ctx, secretNamespacedName, foundSecret)
		if err != nil && apiErrors.IsNotFound(err) {
			err = r.Create(ctx, secret)
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
				return r.updateBindStatus(binding, retryCount+1)
			}
			log.Error(err, "failed to update status", "binding", bindingID)
			return err
		}
	}
	return nil
}

func (r *ReconcileSFServiceBinding) handleError(object *osbv1alpha1.SFServiceBinding, result ctrl.Result, inputErr error, lastOperation string, retryCount int) (ctrl.Result, error) {
	ctx := context.Background()

	objectID := object.GetName()
	namespace := object.GetNamespace()
	// Fetch object again before updating
	namespacedName := types.NamespacedName{
		Name:      objectID,
		Namespace: namespace,
	}
	log := r.Log.WithValues("objectID", objectID)

	err := r.Get(ctx, namespacedName, object)
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
		err = r.Delete(ctx, object)
		if err != nil && retryCount < constants.ErrorThreshold {
			log.Info("Retrying", "function", "handleError", "retryCount", retryCount+1, "lastOperation", lastOperation, "err", inputErr, "objectID", objectID)
			return r.handleError(object, result, inputErr, lastOperation, retryCount+1)
		} else if err == nil {
			object.SetState("delete")
			err = r.Update(ctx, object)
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
		err := r.Update(ctx, object)
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
	err = r.Update(ctx, object)
	if err != nil {
		if retryCount < constants.ErrorThreshold {
			log.Info("Retrying", "function", "handleError", "retryCount", retryCount+1, "lastOperation", lastOperation, "err", inputErr, "objectID", objectID)
			return r.handleError(object, result, inputErr, lastOperation, retryCount+1)
		}
		log.Error(err, "Failed to update error count label", "objectID", objectID, "count", count)
	}
	return result, inputErr
}

// Will kill the process if watchlist has changed
func (r *ReconcileSFServiceBinding) restartOnWatchUpdate() {
	if !constants.K8SDeployment {
		return
	}
	interoperatorCfg := r.cfgManager.GetConfig()
	if !watches.CompareWatchLists(interoperatorCfg.BindingContollerWatchList, r.watchList) {
		r.Log.Info("Binding watch list changed. Restarting interoperator")
		os.Exit(1)
	}
}

// SetupWithManager registers the SFServiceBinding Controller with manager
// and setups the watches.
func (r *ReconcileSFServiceBinding) SetupWithManager(mgr ctrl.Manager) error {
	if r.Log.GetSink() == nil {
		r.Log = ctrl.Log.WithName("provisioners").WithName("binding")
	}
	if r.clusterRegistry == nil {
		clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
		if err != nil {
			return err
		}
		r.clusterRegistry = clusterRegistry
	}

	if r.resourceManager == nil {
		r.resourceManager = resources.New()
	}

	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	r.cfgManager = cfgManager

	builder := ctrl.NewControllerManagedBy(mgr).
		Named("binding").
		WithOptions(controller.Options{
			MaxConcurrentReconciles: interoperatorCfg.BindingWorkerCount,
		}).
		For(&osbv1alpha1.SFServiceBinding{})

	// TODO dynamically setup rbac rules and watches
	r.watchList = make([]osbv1alpha1.APIVersionKind, len(interoperatorCfg.BindingContollerWatchList))
	copy(r.watchList, interoperatorCfg.BindingContollerWatchList)
	subresources := make([]client.Object, len(r.watchList))
	for i, gvk := range r.watchList {
		object := &unstructured.Unstructured{}
		object.SetKind(gvk.GetKind())
		object.SetAPIVersion(gvk.GetAPIVersion())
		subresources[i] = object
	}

	for _, subresource := range subresources {
		builder = builder.Watches(
			subresource,
			handler.EnqueueRequestForOwner(mgr.GetScheme(), mgr.GetRESTMapper(), &osbv1alpha1.SFServiceBinding{}),
		)
	}
	builder = builder.WithEventFilter(watches.NamespaceLabelFilter())

	return builder.Complete(r)
}
