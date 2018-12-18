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

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	clusterFactory "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/cluster/factory"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/resources"

	appsv1 "k8s.io/api/apps/v1"
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

// Add creates a new SFServiceBinding Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
func Add(mgr manager.Manager) error {
	return add(mgr, newReconciler(mgr))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager) reconcile.Reconciler {
	clusterFactory, _ := clusterFactory.New(mgr)
	return &ReconcileSFServiceBinding{
		Client:         mgr.GetClient(),
		scheme:         mgr.GetScheme(),
		clusterFactory: clusterFactory,
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

	postgres := &unstructured.Unstructured{}
	postgres.SetKind("Postgres")
	postgres.SetAPIVersion("kubedb.com/v1alpha1")
	subresources := []runtime.Object{
		&appsv1.Deployment{},
		&corev1.ConfigMap{},
		postgres,
	}

	for _, subresource := range subresources {
		err = c.Watch(&source.Kind{Type: subresource}, &handler.EnqueueRequestForOwner{
			IsController: true,
			OwnerType:    &osbv1alpha1.SFServiceInstance{},
		})
		if err != nil {
			return err
		}
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileSFServiceBinding{}

// ReconcileSFServiceBinding reconciles a SFServiceBinding object
type ReconcileSFServiceBinding struct {
	client.Client
	scheme         *runtime.Scheme
	clusterFactory *clusterFactory.ClusterFactory
}

// Reconcile reads that state of the cluster for a SFServiceBinding object and makes changes based on the state read
// and what is in the SFServiceBinding.Spec
// TODO(user): Modify this Reconcile function to implement your Controller logic.  The scaffolding writes
// a Deployment as an example
// Automatically generate RBAC rules to allow the Controller to read and write Deployments
// +kubebuilder:rbac:groups=kubedb.com,resources=Postgres,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=,resources=configmap,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=osb.servicefabrik.io,resources=sfservicebindings,verbs=get;list;watch;create;update;patch;delete
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
		return reconcile.Result{}, err
	}

	labels := binding.GetLabels()
	stateLabel, ok := labels["state"]
	if ok {
		switch stateLabel {
		case "delete":
			err = r.Delete(context.TODO(), binding)
			if err != nil {
				return reconcile.Result{}, err
			}
			log.Printf("binding %s deleted\n", request.NamespacedName)
			return reconcile.Result{}, nil
		case "in_queue":
			if binding.Status.State == "succeeded" {
				labels["state"] = "succeeded"
				binding.SetLabels(labels)
				err = r.Update(context.TODO(), binding)
				if err != nil {
					return reconcile.Result{}, err
				}
				log.Printf("binding %s state label updated to succeeded\n", request.NamespacedName)
			}
		}
	}

	serviceID := binding.Spec.ServiceID
	planID := binding.Spec.PlanID
	instanceID := binding.Spec.InstanceID
	bindingID := binding.GetName()
	expectedResources, err := resources.ComputeExpectedResources(r, instanceID, bindingID, serviceID, planID, osbv1alpha1.BindAction, binding.GetNamespace())
	if err != nil {
		err = resources.SetOwnerReference(binding, expectedResources, r.scheme)
		if err != nil {
			return reconcile.Result{}, err
		}

		targetClient, err := r.clusterFactory.GetCluster(instanceID, bindingID, serviceID, planID)
		if err != nil {
			return reconcile.Result{}, err
		}

		_, err = resources.ReconcileResources(r, targetClient, expectedResources)
		if err != nil {
			log.Printf("Reconcile error %v\n", err)
		}
	}

	err = r.updateBindStatus(instanceID, bindingID, serviceID, planID, binding.GetNamespace())
	if err != nil {
		return reconcile.Result{}, err
	}

	return reconcile.Result{}, nil
}
func (r *ReconcileSFServiceBinding) updateBindStatus(instanceID, bindingID, serviceID, planID, namespace string) error {
	targetClient, err := r.clusterFactory.GetCluster(instanceID, bindingID, serviceID, planID)
	if err != nil {
		return err
	}

	properties, err := resources.ComputeProperties(r, targetClient, instanceID, bindingID, serviceID, planID, osbv1alpha1.ProvisionAction, namespace)
	if err != nil {
		log.Printf("error computing properties. %v\n", err)
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
		bindingStatus := properties.Binding
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
			err = r.Create(context.TODO(), secret)
			if err != nil {
				log.Printf("error creating secret. %v\n", err)
				return err
			}
			bindingObj.Status.Response.SecretRef = secretName
		} else if bindingStatus.State == "failed" {
			bindingObj.Status.Error = bindingStatus.Error
		}
		bindingObj.Status.State = bindingStatus.State
		err = r.Update(context.Background(), bindingObj)
		if err != nil {
			log.Printf("error updating status. %v\n", err)
			return err
		}
	}
	return nil
}
