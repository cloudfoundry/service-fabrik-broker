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
	"log"
	"reflect"
	"strconv"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	clusterFactory "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/cluster/factory"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/resources"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
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
	"sigs.k8s.io/controller-runtime/pkg/source"
)

// finalizerName is the name of the finalizer added by interoperator
const (
	finalizerName    = "interoperator.servicefabrik.io"
	errorCountKey    = "interoperator.servicefabrik.io/error"
	lastOperationKey = "interoperator.servicefabrik.io/lastoperation"
	errorThreshold   = 10
)

// Add creates a new SFServiceBinding Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
func Add(mgr manager.Manager) error {
	clusterFactory, _ := clusterFactory.New(mgr)
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
	// Create a new controller
	c, err := controller.New("sfservicebinding-controller", mgr, controller.Options{Reconciler: r})
	if err != nil {
		return err
	}

	// Watch for changes to SFServiceBinding
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.SFServiceBinding{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	// TODO dynamically setup rbac rules and watches
	postgres := &unstructured.Unstructured{}
	postgres.SetKind("Postgres")
	postgres.SetAPIVersion("kubedb.com/v1alpha1")
	directorBind := &unstructured.Unstructured{}
	directorBind.SetKind("DirectorBind")
	directorBind.SetAPIVersion("bind.servicefabrik.io/v1alpha1")
	dockerBind := &unstructured.Unstructured{}
	dockerBind.SetKind("DockerBind")
	dockerBind.SetAPIVersion("bind.servicefabrik.io/v1alpha1")
	postgresqlMtsBind := &unstructured.Unstructured{}
	postgresqlMtsBind.SetKind("PostgresqlMTBind")
	postgresqlMtsBind.SetAPIVersion("bind.servicefabrik.io/v1alpha1")
	vhostMtsBind := &unstructured.Unstructured{}
	vhostMtsBind.SetKind("VirtualHostBind")
	vhostMtsBind.SetAPIVersion("bind.servicefabrik.io/v1alpha1")
	subresources := []runtime.Object{
		postgres,
		directorBind,
		dockerBind,
		postgresqlMtsBind,
		vhostMtsBind,
	}

	for _, subresource := range subresources {
		err = c.Watch(&source.Kind{Type: subresource}, &handler.EnqueueRequestForOwner{
			IsController: true,
			OwnerType:    &osbv1alpha1.SFServiceBinding{},
		})
		if err != nil {
			log.Printf("%v", err)
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
// +kubebuilder:rbac:groups=kubedb.com,resources=Postgres,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=bind.servicefabrik.io,resources=directorbind,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=bind.servicefabrik.io,resources=dockerbind,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=bind.servicefabrik.io,resources=postgresqlmtbind,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=bind.servicefabrik.io,resources=virtualhostbind,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=,resources=configmap,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=osb.servicefabrik.io,resources=sfservicebindings,verbs=get;list;watch;create;update;patch;delete
// TODO dynamically setup rbac rules and watches
func (r *ReconcileSFServiceBinding) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the SFServiceBinding instance
	binding := &osbv1alpha1.SFServiceBinding{}
	err := r.Get(context.TODO(), request.NamespacedName, binding)
	if err != nil {
		if errors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return r.handleError(binding, reconcile.Result{}, err)
	}

	serviceID := binding.Spec.ServiceID
	planID := binding.Spec.PlanID
	instanceID := binding.Spec.InstanceID
	bindingID := binding.GetName()
	state := binding.GetState()
	labels := binding.GetLabels()
	lastOperation, ok := labels[lastOperationKey]
	if !ok {
		lastOperation = "in_queue"
	}
	var requeue bool
	var appliedResources []*unstructured.Unstructured
	var remainingResource []osbv1alpha1.Source

	if binding.GetDeletionTimestamp().IsZero() {
		if !containsString(binding.GetFinalizers(), finalizerName) {
			// The object is not being deleted, so if it does not have our finalizer,
			// then lets add the finalizer and update the object.
			binding.SetFinalizers(append(binding.GetFinalizers(), finalizerName))
			if err := r.Update(context.Background(), binding); err != nil {
				return r.handleError(binding, reconcile.Result{Requeue: true}, nil)
			}
		}
	}

	targetClient, err := r.clusterFactory.GetCluster(instanceID, bindingID, serviceID, planID)
	if err != nil {
		return r.handleError(binding, reconcile.Result{}, err)
	}

	if state == "delete" && !binding.GetDeletionTimestamp().IsZero() {
		// The object is being deleted
		if containsString(binding.GetFinalizers(), finalizerName) {
			// our finalizer is present, so lets handle our external dependency
			// Explicitly delete BindSecret
			secretName := "sf-" + bindingID
			bindSecret := osbv1alpha1.Source{}
			bindSecret.Kind = "Secret"
			bindSecret.APIVersion = "v1"
			bindSecret.Name = secretName
			bindSecret.Namespace = binding.GetNamespace()
			resourceRefs := append(binding.Status.Resources, bindSecret)
			remainingResource, err = r.resourceManager.DeleteSubResources(targetClient, resourceRefs)
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
		expectedResources, err := r.resourceManager.ComputeExpectedResources(r, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, binding.GetNamespace())
		if err != nil {
			return r.handleError(binding, reconcile.Result{}, err)
		}
		err = r.resourceManager.SetOwnerReference(binding, expectedResources, r.scheme)
		if err != nil {
			return r.handleError(binding, reconcile.Result{}, err)
		}

		appliedResources, err = r.resourceManager.ReconcileResources(r, targetClient, expectedResources, binding.Status.Resources)
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
			if !errors.IsNotFound(err) {
				remainingResource = append(remainingResource, subResource)
			}
		}
		if err := r.updateUnbindStatus(targetClient, binding, remainingResource); err != nil {
			return r.handleError(binding, reconcile.Result{}, err)
		}
	} else if lastOperation == "in_queue" || lastOperation == "update" {
		err = r.updateBindStatus(instanceID, bindingID, serviceID, planID, binding.GetNamespace(), appliedResources)
		if err != nil {
			return r.handleError(binding, reconcile.Result{}, err)
		}
	}
	return r.handleError(binding, reconcile.Result{Requeue: requeue}, nil)
}

func (r *ReconcileSFServiceBinding) setInProgress(namespacedName types.NamespacedName, state string) error {
	if state == "in_queue" || state == "update" || state == "delete" {
		binding := &osbv1alpha1.SFServiceBinding{}
		err := r.Get(context.TODO(), namespacedName, binding)
		if err != nil {
			log.Printf("error updating status to in progress. %s\n", err.Error())
			return err
		}
		binding.SetState("in progress")
		labels := binding.GetLabels()
		if labels == nil {
			labels = make(map[string]string)
		}
		labels[lastOperationKey] = state
		binding.SetLabels(labels)
		err = r.Update(context.Background(), binding)
		if err != nil {
			log.Printf("error updating status to in progress. %s\n", err.Error())
			return err
		}
		log.Printf("Updated status to in progress for operation %s\n", state)
	}
	return nil
}

func (r *ReconcileSFServiceBinding) updateUnbindStatus(targetClient client.Client, binding *osbv1alpha1.SFServiceBinding, remainingResource []osbv1alpha1.Source) error {
	serviceID := binding.Spec.ServiceID
	planID := binding.Spec.PlanID
	instanceID := binding.Spec.InstanceID
	bindingID := binding.GetName()
	namespace := binding.GetNamespace()
	computedStatus, err := r.resourceManager.ComputeStatus(r, targetClient, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, namespace)
	if err != nil {
		log.Printf("error computing status. %v\n", err)
		return err
	}

	bindingObj := &osbv1alpha1.SFServiceBinding{}
	namespacedName := types.NamespacedName{
		Name:      bindingID,
		Namespace: namespace,
	}
	err = r.Get(context.TODO(), namespacedName, bindingObj)
	if err != nil {
		log.Printf("error fetching binding. %v\n", err.Error())
		return err
	}

	updateRequired := false
	updatedStatus := binding.Status.DeepCopy()
	updatedStatus.State = computedStatus.Unbind.State
	updatedStatus.Error = computedStatus.Unbind.Error
	updatedStatus.Resources = remainingResource
	if !reflect.DeepEqual(&binding.Status, updatedStatus) {
		updatedStatus.DeepCopyInto(&binding.Status)
		updateRequired = true
	}

	if binding.Status.State == "succeeded" || len(remainingResource) == 0 {
		// remove our finalizer from the list and update it.
		log.Printf("binding %s removing finalizer\n", bindingID)
		binding.SetFinalizers(removeString(binding.GetFinalizers(), finalizerName))
		updateRequired = true
	}

	if updateRequired {
		if err := r.Update(context.Background(), binding); err != nil {
			log.Printf("error updating unbind status %s. %s.\n", bindingID, err.Error())
			return err
		}
	}
	return nil
}

func (r *ReconcileSFServiceBinding) updateBindStatus(instanceID, bindingID, serviceID, planID, namespace string, appliedResources []*unstructured.Unstructured) error {
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

	computedStatus, err := r.resourceManager.ComputeStatus(r, targetClient, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, namespace)
	if err != nil {
		log.Printf("error computing status. %v\n", err)
		return err
	}

	// Fetch object again before updating status
	bindingObj := &osbv1alpha1.SFServiceBinding{}
	namespacedName := types.NamespacedName{
		Name:      bindingID,
		Namespace: namespace,
	}
	err = r.Get(context.TODO(), namespacedName, bindingObj)
	if err != nil {
		log.Printf("error fetching binding. %v\n", err)
		return err
	}
	if bindingObj.Status.State != "succeeded" && bindingObj.Status.State != "failed" {
		updatedStatus := bindingObj.Status.DeepCopy()
		bindingStatus := computedStatus.Bind
		if bindingStatus.State == "succeeded" {
			secretName := "sf-" + bindingID

			data := make(map[string]string)
			data["response"] = bindingStatus.Response
			secret := &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{
					Name:      secretName,
					Namespace: namespace,
				},
				StringData: data,
			}

			if err := controllerutil.SetControllerReference(bindingObj, secret, r.scheme); err != nil {
				log.Printf("error setting owner reference for secret. %v\n", err)
				return err
			}
			secretNamespacedName := types.NamespacedName{
				Name:      secretName,
				Namespace: namespace,
			}
			foundSecret := &corev1.Secret{}
			err = r.Get(context.TODO(), secretNamespacedName, foundSecret)
			if err != nil && errors.IsNotFound(err) {
				err = r.Create(context.TODO(), secret)
				if err != nil {
					log.Printf("error creating secret. %v\n", err)
					return err
				}
			} else if err != nil {
				return err
			} else {
				err = r.Update(context.TODO(), secret)
				if err != nil {
					log.Printf("error updating secret. %v\n", err)
					return err
				}
			}
			updatedStatus.Response.SecretRef = secretName
		} else if bindingStatus.State == "failed" {
			updatedStatus.Error = bindingStatus.Error
		}
		updatedStatus.State = bindingStatus.State
		if appliedResources != nil {
			updatedStatus.Resources = resourceRefs
		}
		if !reflect.DeepEqual(&bindingObj.Status, updatedStatus) {
			updatedStatus.DeepCopyInto(&bindingObj.Status)
			log.Printf("Updating bind status from template for %s\n", namespacedName)
			err = r.Update(context.Background(), bindingObj)
			if err != nil {
				log.Printf("error updating status. %v\n", err)
				return err
			}
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

func (r *ReconcileSFServiceBinding) handleError(object *osbv1alpha1.SFServiceBinding, result reconcile.Result, inputErr error) (reconcile.Result, error) {
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
		log.Printf("Error Updating error count label to %d for binding %s\n", count, id)
	}
	return result, inputErr
}
