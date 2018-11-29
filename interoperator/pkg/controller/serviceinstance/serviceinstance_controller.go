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

package serviceinstance

import (
	"context"
	"log"
	"reflect"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/dynamic"
	rendererFactory "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer/factory"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/services"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/services/properties"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/errors"
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

// Add creates a new ServiceInstance Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
func Add(mgr manager.Manager) error {
	return add(mgr, newReconciler(mgr))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager) reconcile.Reconciler {
	return &ReconcileServiceInstance{Client: mgr.GetClient(), scheme: mgr.GetScheme()}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	// Create a new controller
	c, err := controller.New("serviceinstance-controller", mgr, controller.Options{Reconciler: r})
	if err != nil {
		return err
	}

	// Watch for changes to ServiceInstance
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.ServiceInstance{}}, &handler.EnqueueRequestForObject{})
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
			OwnerType:    &osbv1alpha1.ServiceInstance{},
		})
		if err != nil {
			return err
		}
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileServiceInstance{}

// ReconcileServiceInstance reconciles a ServiceInstance object
type ReconcileServiceInstance struct {
	client.Client
	scheme *runtime.Scheme
}

// Reconcile reads that state of the cluster for a ServiceInstance object and makes changes based on the state read
// and what is in the ServiceInstance.Spec
// TODO(user): Modify this Reconcile function to implement your Controller logic.  The scaffolding writes
// a Deployment as an example
// Automatically generate RBAC rules to allow the Controller to read and write Deployments
// +kubebuilder:rbac:groups=kubedb.com,resources=Postgres,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=,resources=configmap,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=apps,resources=deployments,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=interoperator.servicefabrik.io,resources=serviceinstances,verbs=get;list;watch;create;update;patch;delete
func (r *ReconcileServiceInstance) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the ServiceInstance instance
	instance := &osbv1alpha1.ServiceInstance{}
	err := r.Get(context.TODO(), request.NamespacedName, instance)
	if err != nil {
		if errors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			log.Printf("instance %s deleted\n", request.NamespacedName)
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return reconcile.Result{}, err
	}

	labels := instance.GetLabels()
	stateLabel, ok := labels["state"]
	if ok {
		switch stateLabel {
		case "delete":
			err = r.Delete(context.TODO(), instance)
			if err != nil {
				return reconcile.Result{}, err
			}
			log.Printf("instance %s deleted\n", request.NamespacedName)
			return reconcile.Result{}, nil
		case "in_queue":
			if instance.Status.State == "succeeded" {
				labels["state"] = "succeeded"
				instance.SetLabels(labels)
				err = r.Update(context.TODO(), instance)
				if err != nil {
					return reconcile.Result{}, err
				}
				log.Printf("instance %s state label updated to succeeded\n", request.NamespacedName)
			}
		}
	}

	expectedResources, err := r.computeExpectedResources(instance)
	if err != nil {
		return reconcile.Result{}, err
	}

	_, err = r.reconcileResources(instance, expectedResources)
	if err != nil {
		log.Printf("Reconcile error %v\n", err)
	}

	err = r.updateStatus(instance)
	if err != nil {
		return reconcile.Result{}, err
	}

	return reconcile.Result{}, nil
}

func (r *ReconcileServiceInstance) computeExpectedResources(instance *osbv1alpha1.ServiceInstance) ([]*unstructured.Unstructured, error) {
	serviceID := instance.Spec.ServiceID
	service, err := services.FindServiceInfo(serviceID)
	if err != nil {
		log.Printf("error finding service info with id %s. %v\n", serviceID, err)
		return nil, err
	}

	renderer, err := rendererFactory.GetRenderer(service.Template.Type, nil)
	if err != nil {
		log.Printf("error getting renderer of type %s. %v\n", service.Template.Type, err)
		return nil, err
	}

	input, err := rendererFactory.GetRendererInput(&service.Template, instance)
	if err != nil {
		log.Printf("error creating renderer input of type %s. %v\n", service.Template.Type, err)
		return nil, err
	}

	output, err := renderer.Render(input)
	if err != nil {
		log.Printf("error renderering resources for service %s. %v\n", serviceID, err)
		return nil, err
	}

	files, err := output.ListFiles()
	if err != nil {
		log.Printf("error listing rendered resource files for service %s. %v\n", serviceID, err)
		return nil, err
	}

	resources := make([]*unstructured.Unstructured, 0, len(files))
	for _, file := range files {
		subResourcesString, err := output.FileContent(file)
		if err != nil {
			log.Printf("error getting file content %s. %v\n", file, err)
			continue
		}

		subresources, err := dynamic.StringToUnstructured(subResourcesString)
		if err != nil {
			log.Printf("error converting file content to unstructured %s. %v\n", file, err)
			continue
		}

		for _, obj := range subresources {
			if err := controllerutil.SetControllerReference(instance, obj, r.scheme); err != nil {
				log.Printf("error setting owner reference for subresource in file %s. %v\n", file, err)
				continue
			}
			obj.SetNamespace(instance.Namespace)
			resources = append(resources, obj)
		}
	}

	return resources, nil
}

func (r *ReconcileServiceInstance) reconcileResources(instance *osbv1alpha1.ServiceInstance,
	expectedResources []*unstructured.Unstructured) ([]*unstructured.Unstructured, error) {

	foundResources := make([]*unstructured.Unstructured, 0, len(expectedResources))
	for _, expectedResource := range expectedResources {
		foundResource := &unstructured.Unstructured{}

		kind := expectedResource.GetKind()
		apiVersion := expectedResource.GetAPIVersion()
		foundResource.SetKind(kind)
		foundResource.SetAPIVersion(apiVersion)
		namespacedName := types.NamespacedName{
			Name:      expectedResource.GetName(),
			Namespace: expectedResource.GetNamespace(),
		}

		err := r.Get(context.TODO(), namespacedName, foundResource)
		if err != nil && errors.IsNotFound(err) {
			log.Printf("Creating %s %s\n", kind, namespacedName)
			err = r.Create(context.TODO(), expectedResource)
			if err != nil {
				log.Printf("error creating %s %s. %v\n", kind, namespacedName, err)
				return nil, err
			}
			foundResources = append(foundResources, foundResource)
			break
		} else if err != nil {
			log.Printf("error getting %s %s. %v\n", kind, namespacedName, err)
			return nil, err
		}

		var specKey string
		specKeys := []string{"spec", "Spec", "data", "Data"}
		for _, key := range specKeys {
			if _, ok := expectedResource.Object[key]; ok {
				specKey = key
				break
			}
		}

		if !reflect.DeepEqual(expectedResource.Object[specKey], foundResource.Object[specKey]) {
			foundResource.Object[specKey] = expectedResource.Object[specKey]
			log.Printf("Updating %s %s\n", kind, namespacedName)
			err = r.Update(context.TODO(), foundResource)
			if err != nil {
				log.Printf("error updating %s %s. %v\n", kind, namespacedName, err)
				return nil, err
			}
		} else {
			log.Printf("%s %s already up todate .\n", kind, namespacedName)
		}
		foundResources = append(foundResources, foundResource)
	}
	return foundResources, nil
}

func (r *ReconcileServiceInstance) updateStatus(instance *osbv1alpha1.ServiceInstance) error {
	serviceID := instance.Spec.ServiceID
	service, err := services.FindServiceInfo(serviceID)
	if err != nil {
		log.Printf("error finding service info with id %s. %v\n", serviceID, err)
		return err
	}

	renderer, err := rendererFactory.GetRenderer(service.PropertiesTemplate.Type, nil)
	if err != nil {
		log.Printf("error getting renderer of type %s. %v\n", service.PropertiesTemplate.Type, err)
		return err
	}

	input, err := rendererFactory.GetRendererInput(&service.PropertiesTemplate, instance)
	if err != nil {
		log.Printf("error creating renderer input of type %s. %v\n", service.PropertiesTemplate.Type, err)
		return err
	}

	output, err := renderer.Render(input)
	if err != nil {
		log.Printf("error renderering sources for service %s. %v\n", serviceID, err)
		return err
	}

	sourcesString, err := output.FileContent("sources.yaml")
	if err != nil {
		log.Printf("error getting file content of sources.yaml. %v\n", err)
		return err
	}

	sources, err := properties.ParseSources(sourcesString)
	if err != nil {
		log.Printf("error parsing file content of sources.yaml. %v\n", err)
		return err
	}

	sourceObjects := make(map[string]*unstructured.Unstructured)
	for key, val := range sources {
		obj := &unstructured.Unstructured{}
		obj.SetKind(val.Kind)
		obj.SetAPIVersion(val.APIVersion)
		namespacedName := types.NamespacedName{
			Name:      val.Name,
			Namespace: instance.Namespace,
		}
		err := r.Get(context.TODO(), namespacedName, obj)
		if err != nil {
			log.Printf("failed to fetch resource %v. %v\n", val, err)
			continue
		}
		sourceObjects[key] = obj
	}

	input, err = rendererFactory.GetPropertiesRendererInput(&service.PropertiesTemplate, instance, sourceObjects)
	if err != nil {
		log.Printf("error creating properties renderer input of type %s. %v\n", service.PropertiesTemplate.Type, err)
		return err
	}

	output, err = renderer.Render(input)
	if err != nil {
		log.Printf("error renderering properties for service %s. %v\n", serviceID, err)
		return err
	}

	propertiesString, err := output.FileContent("properties.yaml")
	if err != nil {
		log.Printf("error getting file content of properties.yaml. %v\n", err)
		return err
	}

	properties, err := properties.ParseProperties(propertiesString)
	if err != nil {
		log.Printf("error parsing file content of properties.yaml. %v\n", err)
		return err
	}

	// Fetch object again before updating status
	instanceObj := &osbv1alpha1.ServiceInstance{}
	namespacedName := types.NamespacedName{
		Name:      instance.GetName(),
		Namespace: instance.GetNamespace(),
	}
	err = r.Get(context.TODO(), namespacedName, instanceObj)
	if err != nil {
		log.Printf("error fetching instance. %v\n", err)
		return err
	}

	instanceObj.Status = properties.Status
	err = r.Update(context.Background(), instanceObj)
	if err != nil {
		log.Printf("error updating status. %v\n", err)
		return err
	}
	return nil
}
