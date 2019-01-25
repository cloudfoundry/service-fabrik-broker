package resources

import (
	"context"
	"fmt"
	"log"
	"reflect"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/properties"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/dynamic"
	rendererFactory "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer/factory"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/services"

	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
)

const (
	defaultNamespace = "default"
)

// ResourceManager defines the interface implemented by resources
//go:generate mockgen -source resources.go -destination ./mock_resources/mock_resources.go
type ResourceManager interface {
	ComputeExpectedResources(client kubernetes.Client, instanceID, bindingID, serviceID, planID, action, namespace string) ([]*unstructured.Unstructured, error)
	SetOwnerReference(owner metav1.Object, resources []*unstructured.Unstructured, scheme *runtime.Scheme) error
	ReconcileResources(sourceClient kubernetes.Client, targetClient kubernetes.Client, expectedResources []*unstructured.Unstructured, lastResources []osbv1alpha1.Source) ([]*unstructured.Unstructured, error)
	ComputeStatus(sourceClient kubernetes.Client, targetClient kubernetes.Client, instanceID, bindingID, serviceID, planID, action, namespace string) (*properties.Status, error)
	DeleteSubResources(client kubernetes.Client, subResources []osbv1alpha1.Source) ([]osbv1alpha1.Source, error)
}

type resourceManager struct {
}

// New creates a new ResourceManager object.
func New() ResourceManager {
	return resourceManager{}
}

func (r resourceManager) fetchResources(client kubernetes.Client, instanceID, bindingID, serviceID, planID, namespace string) (*osbv1alpha1.SFServiceInstance, *osbv1alpha1.SFServiceBinding, *osbv1alpha1.SFService, *osbv1alpha1.SFPlan, error) {
	var instance *osbv1alpha1.SFServiceInstance
	var binding *osbv1alpha1.SFServiceBinding
	var service *osbv1alpha1.SFService
	var plan *osbv1alpha1.SFPlan
	var err error

	if instanceID != "" {
		instance = &osbv1alpha1.SFServiceInstance{}
		err = client.Get(context.TODO(), types.NamespacedName{
			Name:      instanceID,
			Namespace: namespace,
		}, instance)
		if err != nil {
			log.Printf("error getting service instance. %v\n", err)
			return nil, nil, nil, nil, err
		}
	}

	if serviceID != "" && planID != "" {
		service, plan, err = services.FindServiceInfo(client, serviceID, planID, defaultNamespace)
		if err != nil {
			log.Printf("error finding service info with id %s. %v\n", serviceID, err)
			return nil, nil, nil, nil, err
		}
	}

	if bindingID != "" {
		binding = &osbv1alpha1.SFServiceBinding{}
		err := client.Get(context.TODO(), types.NamespacedName{
			Name:      bindingID,
			Namespace: namespace,
		}, binding)
		if err != nil {
			log.Printf("error getting service binding. %v\n", err)
			return nil, nil, nil, nil, err
		}
	}

	return instance, binding, service, plan, nil
}

// ComputeExpectedResources computes expected resources
func (r resourceManager) ComputeExpectedResources(client kubernetes.Client, instanceID, bindingID, serviceID, planID, action, namespace string) ([]*unstructured.Unstructured, error) {
	instance, binding, service, plan, err := r.fetchResources(client, instanceID, bindingID, serviceID, planID, namespace)
	if err != nil {
		log.Printf("error getting resource. %v\n", err)
		return nil, err
	}

	if plan == nil || service == nil {
		return nil, fmt.Errorf("failed to get service or plan details")
	}

	name := types.NamespacedName{
		Namespace: namespace,
		Name:      instance.GetName(),
	}

	switch action {
	case osbv1alpha1.BindAction:
		name.Name = binding.GetName()
	}

	template, err := plan.GetTemplate(action)
	if err != nil {
		log.Printf("plan %s does not have %s template. %v\n", planID, action, err)
		return nil, err
	}

	renderer, err := rendererFactory.GetRenderer(template.Type, nil)
	if err != nil {
		log.Printf("error getting renderer of type %s. %v\n", template.Type, err)
		return nil, err
	}

	input, err := rendererFactory.GetRendererInput(template, service, plan, instance, binding, name)
	if err != nil {
		log.Printf("error creating renderer input of type %s. %v\n", template.Type, err)
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
			return nil, err
		}

		subresources, err := dynamic.StringToUnstructured(subResourcesString)
		if err != nil {
			log.Printf("error converting file content to unstructured %s. %v\n", file, err)
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
		if err := controllerutil.SetControllerReference(owner, obj, scheme); err != nil {
			log.Printf("error setting owner reference for resource. %v\n", err)
			return err
		}
	}
	return nil
}

// ReconcileResources setups all resources according to expectation
func (r resourceManager) ReconcileResources(sourceClient kubernetes.Client, targetClient kubernetes.Client, expectedResources []*unstructured.Unstructured, lastResources []osbv1alpha1.Source) ([]*unstructured.Unstructured, error) {
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

		err := targetClient.Get(context.TODO(), namespacedName, foundResource)
		if err != nil && errors.IsNotFound(err) {
			log.Printf("Creating %s %s\n", kind, namespacedName)
			err = targetClient.Create(context.TODO(), expectedResource)
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
			if _, ok := expectedResource.Object["status"]; ok {
				if _, ok := foundResource.Object["status"]; !ok {
					foundResource.Object["status"] = expectedResource.Object["status"]
				} else {
					newStatusObj := dynamic.MapInterfaceToMapString(expectedResource.Object["status"])
					newStatus := newStatusObj.(map[string]interface{})
					oldStatusObj := dynamic.MapInterfaceToMapString(foundResource.Object["status"])
					oldStatus := oldStatusObj.(map[string]interface{})
					for key, val := range newStatus {
						oldStatus[key] = val
					}
					foundResource.Object["status"] = oldStatus
				}
			}
			log.Printf("Updating %s %s\n", kind, namespacedName)
			err = targetClient.Update(context.TODO(), foundResource)
			if err != nil {
				log.Printf("error updating %s %s. %v\n", kind, namespacedName, err)
				return nil, err
			}
		} else {
			log.Printf("%s %s already up todate .\n", kind, namespacedName)
		}
		foundResources = append(foundResources, foundResource)
	}

	for _, lastResource := range lastResources {
		oldResource := &unstructured.Unstructured{}
		oldResource.SetKind(lastResource.Kind)
		oldResource.SetAPIVersion(lastResource.APIVersion)
		oldResource.SetName(lastResource.Name)
		oldResource.SetNamespace(lastResource.Namespace)
		if ok := r.findUnstructuredObject(foundResources, oldResource); !ok {
			err := targetClient.Delete(context.TODO(), oldResource)
			if err != nil {
				// Not failing here. Add the outdated resource to foundResource
				// Delete will be retried on next reconcile
				log.Printf("failed to delete outdated resource %v. %v", lastResource, err)
				foundResources = append(foundResources, oldResource)
				continue
			}
			log.Printf("deleted outdated resource %v", lastResource)
		}
	}
	return foundResources, nil
}

func (r resourceManager) findUnstructuredObject(list []*unstructured.Unstructured, item *unstructured.Unstructured) bool {
	for _, object := range list {
		if object.GetKind() == item.GetKind() && object.GetAPIVersion() == item.GetAPIVersion() && object.GetName() == item.GetName() && object.GetNamespace() == item.GetNamespace() {
			return true
		}
	}
	return false
}

// ComputeStatus computes status template
func (r resourceManager) ComputeStatus(sourceClient kubernetes.Client, targetClient kubernetes.Client, instanceID, bindingID, serviceID, planID, action, namespace string) (*properties.Status, error) {
	instance, binding, service, plan, err := r.fetchResources(sourceClient, instanceID, bindingID, serviceID, planID, namespace)
	if err != nil {
		log.Printf("error getting resource. %v\n", err)
		return nil, err
	}

	if plan == nil || service == nil {
		return nil, fmt.Errorf("failed to get service or plan details")
	}

	name := types.NamespacedName{
		Namespace: namespace,
		Name:      instance.GetName(),
	}

	switch action {
	case osbv1alpha1.BindAction:
		name.Name = binding.GetName()
	}

	template, err := plan.GetTemplate(osbv1alpha1.SourcesAction)
	if err != nil {
		log.Printf("plan %s does not have sources template. %v\n", planID, err)
		return nil, err
	}

	renderer, err := rendererFactory.GetRenderer(template.Type, nil)
	if err != nil {
		log.Printf("error getting renderer of type %s. %v\n", template.Type, err)
		return nil, err
	}

	input, err := rendererFactory.GetRendererInput(template, service, plan, instance, binding, name)
	if err != nil {
		log.Printf("error creating renderer input of type %s. %v\n", template.Type, err)
		return nil, err
	}

	output, err := renderer.Render(input)
	if err != nil {
		log.Printf("error renderering sources for service %s. %v\n", serviceID, err)
		return nil, err
	}

	files, err := output.ListFiles()
	if err != nil {
		log.Printf("error listing rendered resource files for service %s. %v\n", serviceID, err)
		return nil, err
	}

	if len(files) == 0 {
		log.Printf("sources template did not genarate any file. %v\n", err)
		return nil, err
	}

	sourcesFileName := files[0]
	for _, file := range files {
		if file == "sources.yaml" {
			sourcesFileName = file
			break
		}
	}

	sourcesString, err := output.FileContent(sourcesFileName)
	if err != nil {
		log.Printf("error getting file content of sources.yaml. %v\n", err)
		return nil, err
	}

	sources, err := properties.ParseSources(sourcesString)
	if err != nil {
		log.Printf("error parsing file content of sources.yaml. %v\n", err)
		return nil, err
	}

	sourceObjects := make(map[string]*unstructured.Unstructured)
	for key, val := range sources {
		if val.Name != "" {
			obj := &unstructured.Unstructured{}
			obj.SetKind(val.Kind)
			obj.SetAPIVersion(val.APIVersion)
			namespacedName := types.NamespacedName{
				Name:      val.Name,
				Namespace: name.Namespace,
			}
			err := targetClient.Get(context.TODO(), namespacedName, obj)
			if err != nil {
				// Not failing here as the resource might not exist
				log.Printf("failed to fetch resource %v. %v\n", val, err)
				continue
			}
			sourceObjects[key] = obj
		}
	}

	template, err = plan.GetTemplate(osbv1alpha1.StatusAction)
	if err != nil {
		log.Printf("plan %s does not have status template. %v\n", planID, err)
		return nil, err
	}

	renderer, err = rendererFactory.GetRenderer(template.Type, nil)
	if err != nil {
		log.Printf("error getting renderer of type %s. %v\n", template.Type, err)
		return nil, err
	}

	input, err = rendererFactory.GetStatusRendererInput(template, name, sourceObjects)
	if err != nil {
		log.Printf("error creating status renderer input of type %s. %v\n", template.Type, err)
		return nil, err
	}

	output, err = renderer.Render(input)
	if err != nil {
		log.Printf("error renderering status for service %s. %v\n", serviceID, err)
		return nil, err
	}

	files, err = output.ListFiles()
	if err != nil {
		log.Printf("error listing rendered resource files for service %s. %v\n", serviceID, err)
		return nil, err
	}

	if len(files) == 0 {
		log.Printf("status template did not genarate any file. %v\n", err)
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
		log.Printf("error getting file content of status.yaml. %v\n", err)
		return nil, err
	}

	status, err := properties.ParseStatus(statusString)
	if err != nil {
		log.Printf("error parsing file content of status.yaml. %v\n", err)
		return nil, err
	}

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
		err := r.deleteSubResource(client, resource)
		if err != nil {
			if errors.IsNotFound(err) {
				log.Printf("deleted completed for resource %v", subResource)
				continue
			}
			log.Printf("failed to delete resource %v. %v", subResource, err)
			remainingResource = append(remainingResource, subResource)
			lastError = err
			continue
		}
		log.Printf("deleted triggered for resource %v", subResource)
		remainingResource = append(remainingResource, subResource)
	}
	return remainingResource, lastError
}

func (r resourceManager) deleteSubResource(client kubernetes.Client, resource *unstructured.Unstructured) error {
	// Special delete handling for sf operators for delete
	var specialDelete = [...]string{"deployment.servicefabrik.io/v1alpha1", "bind.servicefabrik.io/v1alpha1"}
	apiVersion := resource.GetAPIVersion()

	for _, val := range specialDelete {
		if apiVersion == val {
			namespacedName := types.NamespacedName{
				Name:      resource.GetName(),
				Namespace: resource.GetNamespace(),
			}
			err := client.Get(context.TODO(), namespacedName, resource)
			if err != nil {
				return err
			}
			content := resource.UnstructuredContent()
			statusInt, ok := content["status"]
			var status map[string]interface{}
			if ok {
				status, ok = statusInt.(map[string]interface{})
				if !ok {
					return fmt.Errorf("status field not map for resource %v", resource)
				}
			} else {
				status = make(map[string]interface{})
			}

			state, ok := status["state"]
			if !ok || state == "succeeded" || state == "failed" {
				status["state"] = "delete"
				content["status"] = status
				resource.SetUnstructuredContent(content)
				err = client.Update(context.TODO(), resource)
				if err != nil {
					return err
				}
			}
			return nil
		}
	}
	return client.Delete(context.TODO(), resource)
}
