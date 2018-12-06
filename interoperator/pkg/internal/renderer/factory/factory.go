package factory

import (
	"fmt"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/dynamic"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer/helm"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/client-go/kubernetes"
)

// GetRenderer returns a renderer based on the type
func GetRenderer(rendererType string, clientSet *kubernetes.Clientset) (renderer.Renderer, error) {
	switch rendererType {
	case "helm", "Helm", "HELM":
		return helm.New(clientSet)
	default:
		return nil, fmt.Errorf("unable to create renderer for type %s. not implemented", rendererType)
	}
}

// GetRendererInput contructs the input required for the renderer
func GetRendererInput(template *osbv1alpha1.TemplateSpec, service *osbv1alpha1.Service, plan *osbv1alpha1.Plan, instance *osbv1alpha1.ServiceInstance) (renderer.Input, error) {
	rendererType := template.Type
	switch rendererType {
	case "helm", "Helm", "HELM":
		values := make(map[string]interface{})

		serviceObj, err := dynamic.ObjectToMapInterface(service)
		if err != nil {
			return nil, err
		}
		values["service"] = serviceObj

		planObj, err := dynamic.ObjectToMapInterface(plan)
		if err != nil {
			return nil, err
		}
		values["plan"] = planObj

		instanceObj, err := dynamic.ObjectToMapInterface(instance)
		if err != nil {
			return nil, err
		}
		values["instance"] = instanceObj

		input := helm.NewInput(template.URL, instance.Name, instance.Namespace, values)
		return input, nil
	default:
		return nil, fmt.Errorf("unable to create renderer for type %s. not implemented", rendererType)
	}
}

// GetPropertiesRendererInput contructs the input required for the renderer
func GetPropertiesRendererInput(template *osbv1alpha1.TemplateSpec, instance *osbv1alpha1.ServiceInstance, sources map[string]*unstructured.Unstructured) (renderer.Input, error) {
	rendererType := template.Type
	switch rendererType {
	case "helm", "Helm", "HELM":
		values := make(map[string]interface{})

		for key, val := range sources {
			values[key] = val.Object
		}
		input := helm.NewInput(template.URL, instance.Name, instance.Namespace, values)
		return input, nil
	default:
		return nil, fmt.Errorf("unable to create renderer for type %s. not implemented", rendererType)
	}
}
