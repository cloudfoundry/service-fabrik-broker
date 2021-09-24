package resources

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/dynamic"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/properties"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"

	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
)

var log = logf.Log.WithName("resources.internal")

// ResourceManager defines the interface implemented by resources
//go:generate mockgen -source resources.go -destination ./mock_resources/mock_resources.go
type ResourceManager interface {
	ComputeExpectedResources(client kubernetes.Client, instanceID, bindingID, serviceID, planID, action, namespace string) ([]*unstructured.Unstructured, error)
	SetOwnerReference(owner metav1.Object, resources []*unstructured.Unstructured, scheme *runtime.Scheme) error
	ReconcileResources(client kubernetes.Client, expectedResources []*unstructured.Unstructured, lastResources []osbv1alpha1.Source, force bool) ([]osbv1alpha1.Source, error)
	ComputeStatus(client kubernetes.Client, instanceID, bindingID, serviceID, planID, action, namespace string) (*properties.Status, error)
	DeleteSubResources(client kubernetes.Client, subResources []osbv1alpha1.Source) ([]osbv1alpha1.Source, error)
}

type resourceManager struct {
}

// New creates a new ResourceManager object.
func New() ResourceManager {
	return resourceManager{}
}

// ComputeExpectedResources computes expected resources
func (r resourceManager) ComputeExpectedResources(client kubernetes.Client, instanceID, bindingID, serviceID, planID,
	action, namespace string) ([]*unstructured.Unstructured, error) {

	log := log.WithValues("serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "action", action, "namespace", namespace)
	instance, binding, service, plan, err := fetchResources(client, instanceID, bindingID, serviceID, planID, namespace)
	if err != nil {
		log.Error(err, "failed fetching resources to compute expected resources")
		return nil, err
	}

	name := types.NamespacedName{
		Namespace: namespace,
		Name:      instance.GetName(),
	}

	switch action {
	case osbv1alpha1.BindAction, osbv1alpha1.UnbindAction:
		name.Name = binding.GetName()
	}

	output, err := renderTemplate(client, instance, binding, service, plan, action)
	if err != nil {
		log.Error(err, "failed to render")
		return nil, err
	}

	files, err := output.ListFiles()
	if err != nil {
		log.Error(err, "failed listing rendered resource files")
		return nil, err
	}

	resources := make([]*unstructured.Unstructured, 0, len(files))
	for _, file := range files {
		subResourcesString, err := output.FileContent(file)
		if err != nil {
			log.Error(err, "failed to get rendered file content", "file", file)
			return nil, err
		}

		subresources, err := dynamic.StringToUnstructured(subResourcesString)
		if err != nil {
			log.Error(err, "failed converting file content to unstructured", "file", file)
			return nil, err
		}

		for _, obj := range subresources {
			obj.SetNamespace(namespace)
			resources = append(resources, obj)
		}
	}
	return resources, nil
}

// SetOwnerReference updates the owner reference for all the resources
func (r resourceManager) SetOwnerReference(owner metav1.Object, resources []*unstructured.Unstructured, scheme *runtime.Scheme) error {
	for _, obj := range resources {
		if err := utils.SetOwnerReference(owner, obj, scheme); err != nil {
			log.Error(err, "failed setting owner reference for resource", "owner", owner, "resource", obj)
			return err
		}
	}
	return nil
}

// ReconcileResources setups all resources according to expectation
func (r resourceManager) ReconcileResources(client kubernetes.Client, expectedResources []*unstructured.Unstructured, lastResources []osbv1alpha1.Source, force bool) ([]osbv1alpha1.Source, error) {
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
		foundResource.SetName(namespacedName.Name)
		foundResource.SetNamespace(namespacedName.Namespace)

		err := client.Get(context.TODO(), namespacedName, foundResource)
		if err != nil && apiErrors.IsNotFound(err) {
			log.Info("reconcile - creating resource", "kind", kind, "namespacedName", namespacedName)
			err = client.Create(context.TODO(), expectedResource)
			if err != nil {
				log.Error(err, "reconcile - failed to create resource", "kind", kind, "namespacedName", namespacedName)
				return nil, err
			}
			foundResources = append(foundResources, foundResource)
			continue
		} else if err != nil {
			log.Error(err, "reconcile - failed fetching resource", "kind", kind, "namespacedName", namespacedName)
			return nil, err
		}

		toBeUpdated := false
		var updatedResource interface{}
		log.V(2).Info("reconcile - expectedResource resource", "foundResource", foundResource.Object, "expectedResource", expectedResource.Object)
		if !force {
			updatedResource, toBeUpdated, err = dynamic.DeepUpdate(foundResource.Object, expectedResource.Object)
			if err != nil {
			    log.Error(err, "reconcile- failed to update resource ", "kind ", kind, "namespacedName ", namespacedName)
			    return nil, err
			}
		}
		if toBeUpdated || force {
			log.Info("reconcile - updating resource", "kind", kind, "namespacedName", namespacedName)
			if force {
				log.Info("reconcile - force updating resource", "resource", expectedResource.Object)
				err = client.Update(context.TODO(), expectedResource)
			} else {
				foundResource.Object = updatedResource.(map[string]interface{})
				log.Info("reconcile - updating resource", "resource", foundResource.Object)
				err = client.Update(context.TODO(), foundResource)
			}
			if err != nil {
				log.Error(err, "reconcile- failed to update resource", "kind", kind, "namespacedName", namespacedName)
				return nil, err
			}
		} else {
			log.Info("reconcile - resource already up todate", "kind", kind, "namespacedName", namespacedName)
		}
		foundResources = append(foundResources, foundResource)
	}

	for _, lastResource := range lastResources {
		oldResource := &unstructured.Unstructured{}
		oldResource.SetKind(lastResource.Kind)
		oldResource.SetAPIVersion(lastResource.APIVersion)
		oldResource.SetName(lastResource.Name)
		oldResource.SetNamespace(lastResource.Namespace)
		if ok := findUnstructuredObject(foundResources, oldResource); !ok {
			err := deleteSubResource(client, oldResource)
			if err != nil {
				if apiErrors.IsNotFound(err) {
					log.Info("deleted completed for outdated subResource", "resource", lastResource)
					continue
				}

				// Not failing here. Add the outdated resource to foundResource
				// Delete will be retried on next reconcile
				log.Error(err, "reconcile - failed to delete outdated subResource", "resource", lastResource)
				foundResources = append(foundResources, oldResource)
				continue
			}
			log.Info("reconcile - delete triggered for outdated subResource", "resource", lastResource)
		}
	}
	resourceRefs := []osbv1alpha1.Source{}
	for _, object := range foundResources {
		resourceRefs = append(resourceRefs, unstructuredToSource(object))
	}
	return resourceRefs, nil
}

// ComputeStatus computes status template
func (r resourceManager) ComputeStatus(client kubernetes.Client, instanceID, bindingID, serviceID, planID, action, namespace string) (*properties.Status, error) {
	log := log.WithValues("serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "action", action, "namespace", namespace)
	instance, binding, service, plan, err := fetchResources(client, instanceID, bindingID, serviceID, planID, namespace)
	if err != nil {
		log.Error(err, "failed fetching resources to compute status")
		return nil, err
	}

	name := types.NamespacedName{
		Namespace: namespace,
		Name:      instance.GetName(),
	}

	switch action {
	case osbv1alpha1.BindAction, osbv1alpha1.UnbindAction:
		name.Name = binding.GetName()
	}

	output, err := renderTemplate(client, instance, binding, service, plan, osbv1alpha1.StatusAction)
	if err != nil {
		log.Error(err, "failed to render status")
		return nil, err
	}

	files, err := output.ListFiles()
	if err != nil {
		log.Error(err, "failed listing rendered status files")
		return nil, err
	}

	if len(files) == 0 {
		log.Error(err, "status template did not genarate any file")
		return nil, err
	}

	statusFileName := files[0]
	for _, file := range files {
		if file == "status.yaml" {
			statusFileName = file
			break
		}
	}

	statusString, err := output.FileContent(statusFileName)
	if err != nil {
		log.Error(err, "failed to get status file content", "file", statusFileName)
		return nil, err
	}

	status, err := properties.ParseStatus(statusString)
	if err != nil {
		log.Error(err, "failed parsing file content of status", "file", statusFileName)
		return nil, err
	}

	log.V(2).Info("computed status", "status", status)
	return status, nil
}

// DeleteSubResources setups all resources according to expectation
func (r resourceManager) DeleteSubResources(client kubernetes.Client, subResources []osbv1alpha1.Source) ([]osbv1alpha1.Source, error) {
	//
	// delete the external dependency here
	//
	// Ensure that delete implementation is idempotent and safe to invoke
	// multiple types for same object.

	var remainingResource []osbv1alpha1.Source
	var lastError error

	for _, subResource := range subResources {
		resource := &unstructured.Unstructured{}
		resource.SetKind(subResource.Kind)
		resource.SetAPIVersion(subResource.APIVersion)
		resource.SetName(subResource.Name)
		resource.SetNamespace(subResource.Namespace)
		err := deleteSubResource(client, resource)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				log.Info("deleted completed for subResource", "subResource", subResource)
				continue
			}
			log.Error(err, "failed to delete subResource", "subResource", subResource)
			remainingResource = append(remainingResource, subResource)
			lastError = err
			continue
		}
		log.Info("deleted triggered for subResource", "subResource", subResource)
		remainingResource = append(remainingResource, subResource)
	}
	return remainingResource, lastError
}
