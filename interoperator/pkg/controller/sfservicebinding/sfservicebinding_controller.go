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
	"log"
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
	finalizerName  = "interoperator.servicefabrik.io"
	errorCountKey  = "interoperator.servicefabrik.io/error"
	errorThreshold = 10
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

	if binding.GetDeletionTimestamp().IsZero() {
		if !containsString(binding.GetFinalizers(), finalizerName) {
			// The object is not being deleted, so if it does not have our finalizer,
			// then lets add the finalizer and update the object.
			binding.SetFinalizers(append(binding.GetFinalizers(), finalizerName))
			if err := r.Update(context.Background(), binding); err != nil {
				return r.handleError(binding, reconcile.Result{Requeue: true}, nil)
			}
		}
	} else {
		// The object is being deleted
		if containsString(binding.GetFinalizers(), finalizerName) {
			// our finalizer is present, so lets handle our external dependency
			targetClient, err := r.clusterFactory.GetCluster(instanceID, bindingID, serviceID, planID)
			if err != nil {
				return r.handleError(binding, reconcile.Result{}, err)
			}

			// Explicitly delete BindSecret
			secretName := "sf-" + bindingID
			bindSecret := osbv1alpha1.Source{}
			bindSecret.Kind = "Secret"
			bindSecret.APIVersion = "v1"
			bindSecret.Name = secretName
			bindSecret.Namespace = binding.GetNamespace()
			resourceRefs := append(binding.Status.Resources, bindSecret)
			remainingResource, _ := r.resourceManager.DeleteSubResources(targetClient, resourceRefs)
			if err := r.updateUnbindStatus(targetClient, binding, remainingResource); err != nil {
				return r.handleError(binding, reconcile.Result{}, err)
			}
			if len(remainingResource) != 0 && binding.Status.State != "failed" {
				return r.handleError(binding, reconcile.Result{Requeue: true}, nil)
			}
		}

		// Our finalizer has finished, so the reconciler can do nothing.
		log.Printf("binding %s deleted\n", request.NamespacedName)
		return reconcile.Result{}, nil
	}

	labels := binding.GetLabels()
	stateLabel, ok := labels["state"]
	if ok {
		switch stateLabel {
		case "in_queue", "update":
			if binding.Status.State == "succeeded" {
				labels["state"] = "succeeded"
				binding.SetLabels(labels)
				err = r.Update(context.TODO(), binding)
				if err != nil {
					return r.handleError(binding, reconcile.Result{}, err)
				}
				log.Printf("binding %s state label updated to succeeded\n", request.NamespacedName)
			}
		}
	}

	var requeue bool
	expectedResources, err := r.resourceManager.ComputeExpectedResources(r, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, binding.GetNamespace())
	if err != nil {
		return r.handleError(binding, reconcile.Result{}, err)
	}
	err = r.resourceManager.SetOwnerReference(binding, expectedResources, r.scheme)
	if err != nil {
		return r.handleError(binding, reconcile.Result{}, err)
	}
	var appliedResources []*unstructured.Unstructured
	targetClient, err := r.clusterFactory.GetCluster(instanceID, bindingID, serviceID, planID)
	if err != nil {
		return r.handleError(binding, reconcile.Result{}, err)
	}

	appliedResources, err = r.resourceManager.ReconcileResources(r, targetClient, expectedResources, binding.Status.Resources)
	if err != nil {
		log.Printf("Reconcile error %v\n", err)
		requeue = true
	}

	err = r.updateBindStatus(instanceID, bindingID, serviceID, planID, binding.GetNamespace(), appliedResources)
	if err != nil {
		return r.handleError(binding, reconcile.Result{}, err)
	}

	return r.handleError(binding, reconcile.Result{Requeue: requeue}, nil)
}

func (r *ReconcileSFServiceBinding) updateUnbindStatus(targetClient client.Client, binding *osbv1alpha1.SFServiceBinding, remainingResource []osbv1alpha1.Source) error {
	serviceID := binding.Spec.ServiceID
	planID := binding.Spec.PlanID
	instanceID := binding.Spec.InstanceID
	bindingID := binding.GetName()
	computedStatus, err := r.resourceManager.ComputeStatus(r, targetClient, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, binding.GetNamespace())
	if err != nil {
		log.Printf("error computing status. %v\n", err)
		return err
	}
	binding.Status.State = computedStatus.Unbind.State
	binding.Status.Error = computedStatus.Unbind.Error
	binding.Status.Resources = remainingResource

	if binding.Status.State == "succeeded" || len(remainingResource) == 0 {
		// remove our finalizer from the list and update it.
		binding.SetFinalizers(removeString(binding.GetFinalizers(), finalizerName))
	}

	if err := r.Update(context.Background(), binding); err != nil {
		return err
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
			bindingObj.Status.Response.SecretRef = secretName
		} else if bindingStatus.State == "failed" {
			bindingObj.Status.Error = bindingStatus.Error
		}
		bindingObj.Status.State = bindingStatus.State
		if appliedResources != nil {
			bindingObj.Status.Resources = resourceRefs
		}
		err = r.Update(context.Background(), bindingObj)
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

func (r *ReconcileSFServiceBinding) handleError(object *osbv1alpha1.SFServiceBinding, result reconcile.Result, inputErr error) (reconcile.Result, error) {
	annotations := object.GetAnnotations()
	var count int64
	id := object.GetName()

	if inputErr == nil {
		count = 0
	} else {
		countString, ok := annotations[errorCountKey]
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
		count++
	}

	if count > errorThreshold {
		log.Printf("Error threshold reached for %s. Ignoring %v\n", id, inputErr)
		return result, nil
	}

	annotations[errorCountKey] = strconv.FormatInt(count, 10)
	object.SetAnnotations(annotations)
	err := r.Update(context.TODO(), object)
	if err != nil {
		log.Printf("Error Updating error count annotation to %d for %s\n", count, id)
		if errors.IsConflict(err) {
			err := r.Get(context.TODO(), types.NamespacedName{
				Name:      object.GetName(),
				Namespace: object.GetNamespace(),
			}, object)
			if err != nil {
				return result, inputErr
			}
			annotations = object.GetAnnotations()
			annotations[errorCountKey] = strconv.FormatInt(count, 10)
			object.SetAnnotations(annotations)
			return r.handleError(object, result, inputErr)
		}
	}
	return result, inputErr
}
