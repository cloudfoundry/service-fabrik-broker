package resources

import (
	"context"
	"fmt"
	"os"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/dynamic"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/properties"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer"
	rendererFactory "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer/factory"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/services"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
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
			if apiErrors.IsNotFound(err) {
				return nil, nil, nil, nil, errors.NewSFServiceInstanceNotFound(instanceID, err)
			}
			log.Error(err, "failed to get service instance", "instanceID", instanceID)
			return nil, nil, nil, nil, err
		}
	}

	if serviceID != "" && planID != "" {
		serviceNamespace := os.Getenv(constants.NamespaceEnvKey)
		if serviceNamespace == "" {
			serviceNamespace = constants.DefaultServiceFabrikNamespace
		}
		service, plan, err = services.FindServiceInfo(client, serviceID, planID, serviceNamespace)
		if err != nil {
			log.Error(err, "failed finding service and plan info", "serviceID", serviceID, "planID", planID)
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
			if apiErrors.IsNotFound(err) {
				return nil, nil, nil, nil, errors.NewSFServiceBindingNotFound(bindingID, err)
			}
			log.Error(err, "failed getting service binding", "bindingID", bindingID)
			return nil, nil, nil, nil, err
		}
	}

	return instance, binding, service, plan, nil
}

func unstructuredToSource(object *unstructured.Unstructured) osbv1alpha1.Source {
	resourceRef := osbv1alpha1.Source{}
	resourceRef.Kind = object.GetKind()
	resourceRef.APIVersion = object.GetAPIVersion()
	resourceRef.Name = object.GetName()
	resourceRef.Namespace = object.GetNamespace()
	return resourceRef
}

func findUnstructuredObject(list []*unstructured.Unstructured, item *unstructured.Unstructured) bool {
	for _, object := range list {
		if object.GetKind() == item.GetKind() && object.GetAPIVersion() == item.GetAPIVersion() && object.GetName() == item.GetName() && object.GetNamespace() == item.GetNamespace() {
			return true
		}
	}
	return false
}

func deleteSubResource(client kubernetes.Client, resource *unstructured.Unstructured) error {
	// Special delete handling for sf operators for delete
	var specialDelete = [...]string{"deployment.servicefabrik.io/v1alpha1", "bind.servicefabrik.io/v1alpha1"}
	apiVersion := resource.GetAPIVersion()

	for _, val := range specialDelete {
		if apiVersion == val {
			namespacedName := types.NamespacedName{
				Name:      resource.GetName(),
				Namespace: resource.GetNamespace(),
			}

			err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
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

				status["state"] = "delete"
				content["status"] = status
				resource.SetUnstructuredContent(content)
				err = client.Update(context.TODO(), resource)
				if err != nil {
					return err
				}
				return nil
			})
			if err != nil {
				return err
			}
			return nil
		}
	}
	return client.Delete(context.TODO(), resource)
}

func computeInputObjects(client kubernetes.Client, instance *osbv1alpha1.SFServiceInstance,
	binding *osbv1alpha1.SFServiceBinding, service *osbv1alpha1.SFService, plan *osbv1alpha1.SFPlan) (map[string]interface{}, error) {

	if instance == nil {
		return nil, errors.NewInputError("computeInputObjects", "instance", nil)
	}

	if plan == nil {
		return nil, errors.NewInputError("computeInputObjects", "plan", nil)
	}

	if service == nil {
		return nil, errors.NewInputError("computeInputObjects", "service", nil)
	}

	serviceID := instance.Spec.ServiceID
	planID := instance.Spec.PlanID
	instanceID := instance.GetName()
	bindingID := ""
	if binding != nil {
		bindingID = binding.GetName()
	}
	namespace := instance.GetNamespace()

	log := log.WithValues("serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "namespace", namespace)

	name := types.NamespacedName{
		Namespace: namespace,
		Name:      instance.GetName(),
	}

	sourceObjects := make(map[string]interface{})
	if service != nil {
		serviceObj, err := dynamic.ObjectToMapInterface(service)
		if err != nil {
			return nil, err
		}
		sourceObjects["service"] = serviceObj
	}

	if plan != nil {
		planObj, err := dynamic.ObjectToMapInterface(plan)
		if err != nil {
			return nil, err
		}
		sourceObjects["plan"] = planObj
	}

	if instance != nil {
		instanceObj, err := dynamic.ObjectToMapInterface(instance)
		if err != nil {
			return nil, err
		}
		sourceObjects["instance"] = instanceObj
	}

	if binding != nil {
		bindingObj, err := dynamic.ObjectToMapInterface(binding)
		if err != nil {
			return nil, err
		}
		sourceObjects["binding"] = bindingObj
	}

	template, err := plan.GetTemplate(osbv1alpha1.SourcesAction)
	if err != nil {
		log.Error(err, "plan does not have sources template")
		return nil, err
	}

	renderer, err := rendererFactory.GetRenderer(template.Type, nil)
	if err != nil {
		log.Error(err, "failed to get sources renderer", "type", template.Type)
		return nil, err
	}

	input, err := rendererFactory.GetRendererInputFromSources(template, name, sourceObjects)
	if err != nil {
		log.Error(err, "failed creating renderer input for sources", "type", template.Type)
		return nil, err
	}

	output, err := renderer.Render(input)
	if err != nil {
		if errors.RendererError(err) {
			rendererError := err.(*errors.InteroperatorError)
			log.Error(rendererError.Err, "failed rendering sources")
			return nil, err
		}
		log.Error(err, "failed rendering sources")
		return nil, err
	}

	files, err := output.ListFiles()
	if err != nil {
		log.Error(err, "failed listing rendered sources files")
		return nil, err
	}

	if len(files) == 0 {
		log.Error(err, "sources template did not genarate any file")
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
		log.Error(err, "failed to get sources file content", "file", sourcesFileName)
		return nil, err
	}

	sources, err := properties.ParseSources(sourcesString)
	if err != nil {
		log.Error(err, "failed parsing file content of sources", "file", sourcesFileName)
		return nil, err
	}

	for key, val := range sources {
		if val.Name != "" {
			obj := &unstructured.Unstructured{}
			obj.SetKind(val.Kind)
			obj.SetAPIVersion(val.APIVersion)
			namespacedName := types.NamespacedName{
				Name:      val.Name,
				Namespace: name.Namespace,
			}
			err := client.Get(context.TODO(), namespacedName, obj)
			if err != nil {
				// Not failing here as the resource might not exist
				log.V(2).Info("failed to fetch resource listed in sources", "resource", val, "err", err)
				continue
			}
			sourceObjects[key] = obj.Object
		}
	}

	return sourceObjects, nil
}

func renderTemplate(client kubernetes.Client, instance *osbv1alpha1.SFServiceInstance,
	binding *osbv1alpha1.SFServiceBinding, service *osbv1alpha1.SFService, plan *osbv1alpha1.SFPlan,
	action string) (renderer.Output, error) {

	if instance == nil {
		return nil, errors.NewInputError("renderTemplate", "instance", nil)
	}

	if plan == nil {
		return nil, errors.NewInputError("renderTemplate", "plan", nil)
	}

	if service == nil {
		return nil, errors.NewInputError("renderTemplate", "service", nil)
	}

	serviceID := instance.Spec.ServiceID
	planID := instance.Spec.PlanID
	instanceID := instance.GetName()
	bindingID := ""
	if binding != nil {
		bindingID = binding.GetName()
	}
	namespace := instance.GetNamespace()

	log := log.WithValues("serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID,
		"namespace", namespace, "action", action)

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
		log.Error(err, "plan does not have template")
		return nil, err
	}

	sourceObjects, err := computeInputObjects(client, instance, binding, service, plan)
	if err != nil {
		log.Error(err, "failed to compute input object for template from sources")
		return nil, err
	}

	renderer, err := rendererFactory.GetRenderer(template.Type, nil)
	if err != nil {
		log.Error(err, "failed to get renderer", "type", template.Type)
		return nil, err
	}

	input, err := rendererFactory.GetRendererInputFromSources(template, name, sourceObjects)
	if err != nil {
		log.Error(err, "failed creating renderer input", "type", template.Type)
		return nil, err
	}

	output, err := renderer.Render(input)
	if err != nil {
		if errors.RendererError(err) {
			rendererError := err.(*errors.InteroperatorError)
			log.Error(rendererError.Err, "failed rendering")
			return nil, err
		}
		log.Error(err, "failed rendering")
		return nil, err
	}

	return output, nil
}
