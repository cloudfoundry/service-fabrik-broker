package watches

import (
	"context"
	"os"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/properties"
	rendererFactory "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer/factory"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var log = logf.Log.WithName("init.watches")

// InitWatchConfig populates the watch configs for instance and binding
// controllers by rendering dummy instance and binding for each plan.
// Must be called before starting controllers.
func InitWatchConfig(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) (bool, error) {
	if kubeConfig == nil {
		return false, errors.NewInputError("InitWatchConfig", "kubeConfig", nil)
	}

	if scheme == nil {
		return false, errors.NewInputError("InitWatchConfig", "scheme", nil)
	}

	c, err := client.New(kubeConfig, client.Options{
		Scheme: scheme,
		Mapper: mapper,
	})
	if err != nil {
		return false, err
	}
	sfNamespace := os.Getenv(constants.NamespaceEnvKey)
	if sfNamespace == "" {
		sfNamespace = constants.DefaultServiceFabrikNamespace
	}
	instanceWatches, bindingWatches, err := computeWatchList(c, sfNamespace)
	if err != nil {
		log.Error(err, "Failed to compute watch lists")
		return false, err
	}

	cfgManager, err := config.New(kubeConfig, scheme, mapper)
	if err != nil {
		return false, err
	}

	return updateWatchConfig(cfgManager, instanceWatches, bindingWatches)
}

func updateWatchConfig(cfgManager config.Config, instanceWatches, bindingWatches []osbv1alpha1.APIVersionKind) (bool, error) {
	interoperatorCfg := cfgManager.GetConfig()
	toUpdate := false
	if !compareWatchLists(interoperatorCfg.InstanceContollerWatchList, instanceWatches) {
		toUpdate = true
		interoperatorCfg.InstanceContollerWatchList = instanceWatches
	}

	if !compareWatchLists(interoperatorCfg.BindingContollerWatchList, bindingWatches) {
		toUpdate = true
		interoperatorCfg.BindingContollerWatchList = bindingWatches
	}

	if toUpdate {
		return true, cfgManager.UpdateConfig(interoperatorCfg)
	}

	log.Info("Watch List in configmap up todate")
	log.V(2).Info("Current watch lists", "InstanceContollerWatchList", instanceWatches, "BindingContollerWatchList", bindingWatches)
	return false, nil
}

func compareWatchLists(list1, list2 []osbv1alpha1.APIVersionKind) bool {
	if len(list1) != len(list2) {
		return false
	}
	list1Map := make(map[osbv1alpha1.APIVersionKind]struct{})
	for _, item := range list1 {
		list1Map[item] = struct{}{}
	}
	for _, item := range list2 {
		_, ok := list1Map[item]
		if !ok {
			return false
		}
	}
	return true
}

type k8sObject interface {
	metav1.Object
	runtime.Object
}

func computeWatchList(c client.Client, sfNamespace string) ([]osbv1alpha1.APIVersionKind, []osbv1alpha1.APIVersionKind, error) {
	serviceInstance := getDummyServiceInstance(sfNamespace)
	serviceBinding := getDummyServiceBinding(sfNamespace)

	plans := &osbv1alpha1.SFPlanList{}
	options := &client.ListOptions{
		Namespace: sfNamespace,
	}

	err := c.List(context.TODO(), plans, options)
	if err != nil {
		return nil, nil, err
	}

	instanceWatchesMap := make(map[osbv1alpha1.APIVersionKind]struct{})
	bindingWatchesMap := make(map[osbv1alpha1.APIVersionKind]struct{})

	for _, plan := range plans.Items {
		iw, bw, err := computePlanWatches(c, &plan, serviceInstance, serviceBinding)
		if err != nil {
			continue
		}
		for _, watch := range iw {
			_, ok := instanceWatchesMap[watch]
			if !ok {
				instanceWatchesMap[watch] = struct{}{}
			}
		}
		for _, watch := range bw {
			_, ok := bindingWatchesMap[watch]
			if !ok {
				bindingWatchesMap[watch] = struct{}{}
			}
		}
	}

	instanceWatches := make([]osbv1alpha1.APIVersionKind, 0, len(instanceWatchesMap))
	for key := range instanceWatchesMap {
		instanceWatches = append(instanceWatches, key)
	}
	bindingWatches := make([]osbv1alpha1.APIVersionKind, 0, len(bindingWatchesMap))
	for key := range bindingWatchesMap {
		bindingWatches = append(bindingWatches, key)
	}
	return instanceWatches, bindingWatches, nil
}

func getDummyServiceInstance(sfNamespace string) *osbv1alpha1.SFServiceInstance {
	var serviceInstance = &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name: "instance-id",
			Labels: map[string]string{
				"state": "in_queue",
			},
		},
		Spec: osbv1alpha1.SFServiceInstanceSpec{
			ServiceID:        "service-id",
			PlanID:           "plan-id",
			RawContext:       nil,
			OrganizationGUID: "organization-guid",
			SpaceGUID:        "space-guid",
			RawParameters:    nil,
			PreviousValues:   nil,
		},
		Status: osbv1alpha1.SFServiceInstanceStatus{
			State: "in_queue",
		},
	}
	serviceInstance.SetNamespace(sfNamespace)
	return serviceInstance
}

func getDummyServiceBinding(sfNamespace string) *osbv1alpha1.SFServiceBinding {
	var serviceBinding = &osbv1alpha1.SFServiceBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name: "binding-id",
			Labels: map[string]string{
				"state": "in_queue",
			},
		},
		Spec: osbv1alpha1.SFServiceBindingSpec{
			ID:                "binding-id",
			InstanceID:        "instance-id",
			PlanID:            "plan-id",
			ServiceID:         "service-id",
			AppGUID:           "app-id",
			AcceptsIncomplete: true,
		},
		Status: osbv1alpha1.SFServiceBindingStatus{
			State: "in_queue",
		},
	}
	serviceBinding.SetNamespace(sfNamespace)
	return serviceBinding
}

func computePlanWatches(c client.Client, plan *osbv1alpha1.SFPlan, instance *osbv1alpha1.SFServiceInstance,
	binding *osbv1alpha1.SFServiceBinding) ([]osbv1alpha1.APIVersionKind, []osbv1alpha1.APIVersionKind, error) {

	service := &osbv1alpha1.SFService{}
	var serviceKey = types.NamespacedName{
		Name:      plan.Spec.ServiceID,
		Namespace: plan.GetNamespace(),
	}
	err := c.Get(context.TODO(), serviceKey, service)
	if err != nil {
		return nil, nil, err
	}

	expected, err := computeSources(c, service, plan, instance, binding, osbv1alpha1.ProvisionAction, instance.GetNamespace())
	if err != nil {
		return nil, nil, err
	}
	iw := make([]osbv1alpha1.APIVersionKind, 0, len(expected))
	for _, object := range expected {
		iw = append(iw, osbv1alpha1.APIVersionKind{
			APIVersion: object.GetAPIVersion(),
			Kind:       object.GetKind(),
		})
	}

	expected, err = computeSources(c, service, plan, instance, binding, osbv1alpha1.BindAction, binding.GetNamespace())
	if err != nil {
		return nil, nil, err
	}
	bw := make([]osbv1alpha1.APIVersionKind, 0, len(expected))
	for _, object := range expected {
		bw = append(bw, osbv1alpha1.APIVersionKind{
			APIVersion: object.GetAPIVersion(),
			Kind:       object.GetKind(),
		})
	}

	return iw, bw, nil
}

func computeSources(c client.Client, service *osbv1alpha1.SFService, plan *osbv1alpha1.SFPlan, instance *osbv1alpha1.SFServiceInstance,
	binding *osbv1alpha1.SFServiceBinding, action, namespace string) (map[string]osbv1alpha1.Source, error) {
	serviceID := service.GetName()
	planID := plan.GetName()
	instanceID := instance.GetName()
	bindingID := binding.GetName()

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
		log.Error(err, "plan does not have sources template", "serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "action", action)
		return nil, err
	}

	renderer, err := rendererFactory.GetRenderer(template.Type, nil)
	if err != nil {
		log.Error(err, "failed to get sources renderer", "serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "action", action, "type", template.Type)
		return nil, err
	}

	input, err := rendererFactory.GetRendererInput(template, service, plan, instance, binding, name)
	if err != nil {
		log.Error(err, "failed creating renderer input for sources", "serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "action", action, "type", template.Type)
		return nil, err
	}

	output, err := renderer.Render(input)
	if err != nil {
		log.Error(err, "failed rendering sources", "serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "action", action)
		if errors.RendererError(err) {
			rendererError := err.(*errors.InteroperatorError)
			log.Error(rendererError.Err, "failed rendering sources")
		}
		return nil, err
	}

	files, err := output.ListFiles()
	if err != nil {
		log.Error(err, "failed listing rendered sources files", "serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "action", action)
		return nil, err
	}

	if len(files) == 0 {
		log.Error(err, "sources template did not genarate any file", "serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "action", action)
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
		log.Error(err, "failed to get sources file content", "serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "action", action, "file", sourcesFileName)
		return nil, err
	}

	sources, err := properties.ParseSources(sourcesString)
	if err != nil {
		log.Error(err, "failed parsing file content of sources", "serviceID", serviceID, "planID", planID, "instanceID", instanceID, "bindingID", bindingID, "action", action, "file", sourcesFileName)
		return nil, err
	}

	return sources, nil
}
