package factory

import (
	"encoding/base64"
	"fmt"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/dynamic"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer/gotemplate"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer/helm"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

// GetRenderer returns a renderer based on the type
func GetRenderer(rendererType string, clientSet *kubernetes.Clientset) (renderer.Renderer, error) {
	switch rendererType {
	case "helm", "Helm", "HELM":
		return helm.New(clientSet)
	case "gotemplate", "Gotemplate", "GoTemplate", "GOTEMPLATE":
		return gotemplate.New()
	default:
		return nil, fmt.Errorf("unable to create renderer for type %s. not implemented", rendererType)
	}
}

// GetRendererInput contructs the input required for the renderer
func GetRendererInput(template *osbv1alpha1.TemplateSpec, service *osbv1alpha1.SFService, plan *osbv1alpha1.SFPlan, instance *osbv1alpha1.SFServiceInstance, binding *osbv1alpha1.SFServiceBinding, name types.NamespacedName) (renderer.Input, error) {
	rendererType := template.Type
	values := make(map[string]interface{})

	if service != nil {
		serviceObj, err := dynamic.ObjectToMapInterface(service)
		if err != nil {
			return nil, err
		}
		values["service"] = serviceObj
	}

	if plan != nil {
		planObj, err := dynamic.ObjectToMapInterface(plan)
		if err != nil {
			return nil, err
		}
		values["plan"] = planObj
	}

	if instance != nil {
		instanceObj, err := dynamic.ObjectToMapInterface(instance)
		if err != nil {
			return nil, err
		}
		values["instance"] = instanceObj
	}

	if binding != nil {
		bindingObj, err := dynamic.ObjectToMapInterface(binding)
		if err != nil {
			return nil, err
		}
		values["binding"] = bindingObj
	}

	switch rendererType {
	case "helm", "Helm", "HELM":
		input := helm.NewInput(template.URL, name.Name, name.Namespace, values)
		return input, nil
	case "gotemplate", "Gotemplate", "GoTemplate", "GOTEMPLATE":
		var content string
		if template.Content != "" {
			content = template.Content
		} else if template.ContentEncoded != "" {
			decodedContent, err := base64.StdEncoding.DecodeString(template.ContentEncoded)
			content = string(decodedContent)
			if err != nil {
				return nil, fmt.Errorf("unable to decode base64 content %v", err)
			}
		}
		input := gotemplate.NewInput(template.URL, content, name.Name, values)
		return input, nil
	default:
		return nil, fmt.Errorf("unable to create renderer for type %s. not implemented", rendererType)
	}
}

// GetStatusRendererInput contructs the input required for the renderer
func GetStatusRendererInput(template *osbv1alpha1.TemplateSpec, name types.NamespacedName, sources map[string]*unstructured.Unstructured) (renderer.Input, error) {
	rendererType := template.Type
	values := make(map[string]interface{})

	for key, val := range sources {
		values[key] = val.Object
	}

	switch rendererType {
	case "helm", "Helm", "HELM":
		input := helm.NewInput(template.URL, name.Name, name.Namespace, values)
		return input, nil
	case "gotemplate", "Gotemplate", "GoTemplate", "GOTEMPLATE":
		var content string
		if template.Content != "" {
			content = template.Content
		} else if template.ContentEncoded != "" {
			decodedContent, err := base64.StdEncoding.DecodeString(template.ContentEncoded)
			content = string(decodedContent)
			if err != nil {
				return nil, fmt.Errorf("unable to decode base64 content %v", err)
			}
		}
		input := gotemplate.NewInput(template.URL, content, name.Name, values)
		return input, nil
	default:
		return nil, fmt.Errorf("unable to create renderer for type %s. not implemented", rendererType)
	}
}
