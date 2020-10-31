package factory

import (
	"encoding/base64"
	"fmt"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/dynamic"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer/gotemplate"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer/helm"

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
func GetRendererInput(template *osbv1alpha1.TemplateSpec, service *osbv1alpha1.SFService, plan *osbv1alpha1.SFPlan,
	instance *osbv1alpha1.SFServiceInstance, binding *osbv1alpha1.SFServiceBinding, name types.NamespacedName) (renderer.Input, error) {

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

	var content string
	if template.Content != "" {
		content = template.Content
	} else if template.ContentEncoded != "" {
		decodedContent, err := base64.StdEncoding.DecodeString(template.ContentEncoded)
		if err != nil {
			return nil, fmt.Errorf("unable to decode base64 content %v", err)
		}
		content = string(decodedContent)
	}

	switch rendererType {
	case "helm", "Helm", "HELM":
		input := helm.NewInput(template.URL, name.Name, name.Namespace, content, values)
		return input, nil
	case "gotemplate", "Gotemplate", "GoTemplate", "GOTEMPLATE":
		if content == "" {
			return nil, fmt.Errorf("content & contentEncoded fields empty for %s template ", template.Action)
		}
		input := gotemplate.NewInput(template.URL, content, fmt.Sprintf("%s/%s", name.Name, template.Action), values)
		return input, nil
	default:
		return nil, fmt.Errorf("unable to create renderer for type %s. not implemented", rendererType)
	}
}

// GetRendererInputFromSources contructs the input required for the renderer
func GetRendererInputFromSources(template *osbv1alpha1.TemplateSpec, name types.NamespacedName,
	sources map[string]interface{}) (renderer.Input, error) {

	rendererType := template.Type
	action := template.Action

	content := " "
	if template.Content != "" {
		content = template.Content
	} else if template.ContentEncoded != "" {
		decodedContent, err := base64.StdEncoding.DecodeString(template.ContentEncoded)
		content = string(decodedContent)
		if err != nil {
			return nil, fmt.Errorf("unable to decode base64 content %v", err)
		}
	}

	switch rendererType {
	case "helm", "Helm", "HELM":
		if action == osbv1alpha1.SourcesAction || action == osbv1alpha1.StatusAction {
			return nil, fmt.Errorf("%s renderer type not supported for %s action", rendererType, action)
		}
		input := helm.NewInput(template.URL, name.Name, name.Namespace, content, sources)
		return input, nil
	case "gotemplate", "Gotemplate", "GoTemplate", "GOTEMPLATE":
		input := gotemplate.NewInput(template.URL, content, fmt.Sprintf("%s/%s", name.Name, action), sources)
		return input, nil
	default:
		return nil, fmt.Errorf("unable to create renderer for type %s. not implemented", rendererType)
	}
}
