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

func fetchResources(client kubernetes.Client, instanceID, bindingID, serviceID, planID, namespace string) (*osbv1alpha1.SFServiceInstance, *osbv1alpha1.SFServiceBinding, *osbv1alpha1.SFService, *osbv1alpha1.SFPlan, error) {
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
		service, plan, err = services.FindServiceInfo(client, serviceID, planID, namespace)
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
func ComputeExpectedResources(client kubernetes.Client, instanceID, bindingID, serviceID, planID, action, namespace string) ([]*unstructured.Unstructured, error) {
	instance, binding, service, plan, err := fetchResources(client, instanceID, bindingID, serviceID, planID, namespace)
	if err != nil {
		log.Printf("error getting resource. %v\n", err)
		return nil, err
	}

	if plan == nil || service == nil {
		return nil, fmt.Errorf("failed to get service or plan details")
	}

	name := types.NamespacedName{
		Namespace: namespace,
	}

	switch action {
	case osbv1alpha1.PropertiesAction:
		name.Name = instance.GetName()
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
			continue
		}

		subresources, err := dynamic.StringToUnstructured(subResourcesString)
		if err != nil {
			log.Printf("error converting file content to unstructured %s. %v\n", file, err)
			continue
		}

		for _, obj := range subresources {
			obj.SetNamespace(namespace)
			resources = append(resources, obj)
		}
	}
	return resources, nil
}

// SetOwnerReference updates the owner reference for all the resources
func SetOwnerReference(owner metav1.Object, resources []*unstructured.Unstructured, scheme *runtime.Scheme) error {
	for _, obj := range resources {
		if err := controllerutil.SetControllerReference(owner, obj, scheme); err != nil {
			log.Printf("error setting owner reference for resource. %v\n", err)
			continue
		}
	}
	return nil
}

// ReconcileResources setups all resources according to expectation
func ReconcileResources(sourceClient kubernetes.Client, targetClient kubernetes.Client, expectedResources []*unstructured.Unstructured) ([]*unstructured.Unstructured, error) {
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
	return foundResources, nil
}

// ComputeProperties computes properties template
func ComputeProperties(sourceClient kubernetes.Client, targetClient kubernetes.Client, instanceID, bindingID, serviceID, planID, action, namespace string) (*properties.Properties, error) {
	instance, binding, service, plan, err := fetchResources(sourceClient, instanceID, bindingID, serviceID, planID, namespace)
	if err != nil {
		log.Printf("error getting resource. %v\n", err)
		return nil, err
	}

	if plan == nil || service == nil {
		return nil, fmt.Errorf("failed to get service or plan details")
	}

	name := types.NamespacedName{
		Namespace: namespace,
	}

	switch action {
	case osbv1alpha1.PropertiesAction:
		name.Name = instance.GetName()
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
		obj := &unstructured.Unstructured{}
		obj.SetKind(val.Kind)
		obj.SetAPIVersion(val.APIVersion)
		namespacedName := types.NamespacedName{
			Name:      val.Name,
			Namespace: name.Namespace,
		}
		err := targetClient.Get(context.TODO(), namespacedName, obj)
		if err != nil {
			log.Printf("failed to fetch resource %v. %v\n", val, err)
			continue
		}
		sourceObjects[key] = obj
	}

	template, err = plan.GetTemplate(osbv1alpha1.PropertiesAction)
	if err != nil {
		log.Printf("plan %s does not have properties template. %v\n", planID, err)
		return nil, err
	}

	renderer, err = rendererFactory.GetRenderer(template.Type, nil)
	if err != nil {
		log.Printf("error getting renderer of type %s. %v\n", template.Type, err)
		return nil, err
	}

	input, err = rendererFactory.GetPropertiesRendererInput(template, name, sourceObjects)
	if err != nil {
		log.Printf("error creating properties renderer input of type %s. %v\n", template.Type, err)
		return nil, err
	}

	output, err = renderer.Render(input)
	if err != nil {
		log.Printf("error renderering properties for service %s. %v\n", serviceID, err)
		return nil, err
	}

	files, err = output.ListFiles()
	if err != nil {
		log.Printf("error listing rendered resource files for service %s. %v\n", serviceID, err)
		return nil, err
	}

	if len(files) == 0 {
		log.Printf("properties template did not genarate any file. %v\n", err)
		return nil, err
	}

	propertiesFileName := files[0]
	for _, file := range files {
		if file == "properties.yaml" {
			propertiesFileName = file
			break
		}
	}

	propertiesString, err := output.FileContent(propertiesFileName)
	if err != nil {
		log.Printf("error getting file content of properties.yaml. %v\n", err)
		return nil, err
	}

	properties, err := properties.ParseProperties(propertiesString)
	if err != nil {
		log.Printf("error parsing file content of properties.yaml. %v\n", err)
		return nil, err
	}

	return properties, nil
}
