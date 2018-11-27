package factory

import (
	"encoding/json"
	"fmt"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer/helm"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/services"

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
func GetRendererInput(template *services.TemplateSpec, instance *osbv1alpha1.ServiceInstance) (renderer.Input, error) {
	rendererType := template.Type
	switch rendererType {
	case "helm", "Helm", "HELM":
		values := make(map[string]interface{})

		options, err := json.Marshal(instance.Spec)
		if err != nil {
			return nil, err
		}
		err = json.Unmarshal(options, &values)
		if err != nil {
			return nil, err
		}

		input := helm.NewInput(template.Path, instance.Name, instance.Namespace, values)
		return input, nil
	default:
		return nil, fmt.Errorf("unable to create renderer for type %s. not implemented", rendererType)
	}
}

// GetPropertiesRendererInput contructs the input required for the renderer
func GetPropertiesRendererInput(template *services.TemplateSpec, instance *osbv1alpha1.ServiceInstance, sources map[string]*unstructured.Unstructured) (renderer.Input, error) {
	rendererType := template.Type
	switch rendererType {
	case "helm", "Helm", "HELM":
		values := make(map[string]interface{})

		for key, val := range sources {
			values[key] = val.Object
		}
		input := helm.NewInput(template.Path, instance.Name, instance.Namespace, values)
		return input, nil
	default:
		return nil, fmt.Errorf("unable to create renderer for type %s. not implemented", rendererType)
	}
}
