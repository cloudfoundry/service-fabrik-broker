package resources

import (
	"context"
	"reflect"
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/dynamic"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer"
	"github.com/onsi/gomega"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
)

func Test_resourceManager_fetchResources(t *testing.T) {
	g := gomega.NewGomegaWithT(t)

	plan := _getDummyPlan()
	service := _getDummyService()
	instance := _getDummyInstance()
	binding := _getDummyBinding()

	var serviceKey = types.NamespacedName{Name: "service-id", Namespace: "default"}
	var planKey = types.NamespacedName{Name: "plan-id", Namespace: "default"}
	var instanceKey = types.NamespacedName{Name: "instance-id", Namespace: "default"}
	var bindingKey = types.NamespacedName{Name: "binding-id", Namespace: "default"}

	g.Expect(c.Create(context.TODO(), service)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), plan)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), binding)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), service)
	defer c.Delete(context.TODO(), plan)
	defer c.Delete(context.TODO(), instance)
	defer c.Delete(context.TODO(), binding)

	g.Eventually(func() error { return c.Get(context.TODO(), serviceKey, service) }, timeout).
		Should(gomega.Succeed())
	g.Eventually(func() error { return c.Get(context.TODO(), planKey, plan) }, timeout).
		Should(gomega.Succeed())
	g.Eventually(func() error { return c.Get(context.TODO(), instanceKey, instance) }, timeout).
		Should(gomega.Succeed())
	g.Eventually(func() error { return c.Get(context.TODO(), bindingKey, binding) }, timeout).
		Should(gomega.Succeed())

	type args struct {
		client     kubernetes.Client
		instanceID string
		bindingID  string
		serviceID  string
		planID     string
		namespace  string
	}
	tests := []struct {
		name    string
		r       resourceManager
		args    args
		want    *osbv1alpha1.SFServiceInstance
		want1   *osbv1alpha1.SFServiceBinding
		want2   *osbv1alpha1.SFService
		want3   *osbv1alpha1.SFPlan
		wantErr bool
	}{
		{
			name: "TestValid",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id",
				serviceID:  "service-id",
				planID:     "plan-id",
				namespace:  "default",
			},
			want:    instance,
			want1:   binding,
			want2:   service,
			want3:   plan,
			wantErr: false,
		},
		{
			name: "TestErrorInstanceNotFound",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id2",
				bindingID:  "binding-id",
				serviceID:  "service-id",
				planID:     "plan-id",
				namespace:  "default",
			},
			want:    nil,
			want1:   nil,
			want2:   nil,
			want3:   nil,
			wantErr: true,
		},
		{
			name: "TestErrorBindingNotFound",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id2",
				serviceID:  "service-id",
				planID:     "plan-id",
				namespace:  "default",
			},
			want:    nil,
			want1:   nil,
			want2:   nil,
			want3:   nil,
			wantErr: true,
		},
		{
			name: "TestErrorServiceNotFound",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id",
				serviceID:  "service-id2",
				planID:     "plan-id",
				namespace:  "default",
			},
			want:    nil,
			want1:   nil,
			want2:   nil,
			want3:   nil,
			wantErr: true,
		},
		{
			name: "TestErrorPlanNotFound",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id",
				serviceID:  "service-id",
				planID:     "plan-id2",
				namespace:  "default",
			},
			want:    nil,
			want1:   nil,
			want2:   nil,
			want3:   nil,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, got1, got2, got3, err := fetchResources(tt.args.client, tt.args.instanceID, tt.args.bindingID, tt.args.serviceID, tt.args.planID, tt.args.namespace)
			if (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.fetchResources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("resourceManager.fetchResources() got = %v, want %v", got, tt.want)
			}
			if !reflect.DeepEqual(got1, tt.want1) {
				t.Errorf("resourceManager.fetchResources() got1 = %v, want %v", got1, tt.want1)
			}
			if tt.want2 != nil && !reflect.DeepEqual(got2.Spec, tt.want2.Spec) {
				t.Errorf("resourceManager.fetchResources() got2 = %v, want %v", got2.Spec, tt.want2.Spec)
			}
			if tt.want3 != nil && !reflect.DeepEqual(got3.Spec, tt.want3.Spec) {
				t.Errorf("resourceManager.fetchResources() got3 = %v, want %v", got3.Spec, tt.want3.Spec)
			}
		})
	}
}

func Test_unstructuredToSource(t *testing.T) {
	type args struct {
		object *unstructured.Unstructured
	}
	obj := &unstructured.Unstructured{}
	obj.SetAPIVersion("apiVersion")
	obj.SetKind("kind")
	obj.SetName("name")
	obj.SetNamespace("namespace")
	tests := []struct {
		name string
		args args
		want osbv1alpha1.Source
	}{
		{
			name: "return source",
			args: args{
				object: obj,
			},
			want: osbv1alpha1.Source{
				Kind:       "kind",
				APIVersion: "apiVersion",
				Name:       "name",
				Namespace:  "namespace",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := unstructuredToSource(tt.args.object); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("unstructuredToSource() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_resourceManager_findUnstructuredObject(t *testing.T) {
	type args struct {
		list []*unstructured.Unstructured
		item *unstructured.Unstructured
	}

	resource := &unstructured.Unstructured{}
	resource.SetAPIVersion("osb.servicefabrik.io/v1alpha1")
	resource.SetKind("SFServiceInstance")
	resource.SetNamespace("default")
	resource.SetName("instance-id")

	resource2 := &unstructured.Unstructured{}
	resource2.SetAPIVersion("osb.servicefabrik.io/v1alpha1")
	resource2.SetKind("SFServiceInstance")
	resource2.SetNamespace("default")
	resource2.SetName("instance-id2")

	tests := []struct {
		name string
		r    resourceManager
		args args
		want bool
	}{
		{
			name: "TestFound",
			r:    resourceManager{},
			args: args{
				list: []*unstructured.Unstructured{resource, resource2},
				item: resource,
			},
			want: true,
		},
		{
			name: "TestNotFound",
			r:    resourceManager{},
			args: args{
				list: []*unstructured.Unstructured{resource},
				item: resource2,
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := findUnstructuredObject(tt.args.list, tt.args.item); got != tt.want {
				t.Errorf("resourceManager.findUnstructuredObject() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_deleteSubResource(t *testing.T) {
	type args struct {
		client   kubernetes.Client
		resource *unstructured.Unstructured
	}
	resource := &unstructured.Unstructured{}
	resource.SetAPIVersion("v1")
	resource.SetKind("ConfigMap")
	resource.SetNamespace("default")
	resource.SetName("configmap")
	tests := []struct {
		name    string
		args    args
		setup   func()
		wantErr bool
	}{
		{
			name: "delete configmap and error if not exist",
			args: args{
				client:   c,
				resource: resource,
			},
			wantErr: true,
		},
		{
			name: "delete configmap and error if not exist",
			args: args{
				client:   c,
				resource: resource,
			},
			setup: func() {
				err := c.Create(context.TODO(), resource)
				if err != nil {
					t.Errorf("Failed to create configmap %v", err)
				}
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			if err := deleteSubResource(tt.args.client, tt.args.resource); (err != nil) != tt.wantErr {
				t.Errorf("deleteSubResource() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func Test_computeInputObjects(t *testing.T) {
	configResource := &unstructured.Unstructured{}
	configResource.SetAPIVersion("v1")
	configResource.SetKind("ConfigMap")
	configResource.SetNamespace("default")
	configResource.SetName("instance-id")
	err := c.Create(context.TODO(), configResource)
	if err != nil {
		t.Errorf("Failed to create configmap %v", err)
	}
	err = c.Get(context.TODO(), types.NamespacedName{
		Name:      "instance-id",
		Namespace: "default",
	}, configResource)
	if err != nil {
		t.Errorf("Failed to get configmap %v", err)
	}

	instanceObj, err := dynamic.ObjectToMapInterface(_getDummyInstance())
	if err != nil {
		t.Errorf("Failed to create instanceObj %v", err)
	}

	bindingObj, err := dynamic.ObjectToMapInterface(_getDummyBinding())
	if err != nil {
		t.Errorf("Failed to create bindingObj %v", err)
	}

	planObj, err := dynamic.ObjectToMapInterface(_getDummyPlan())
	if err != nil {
		t.Errorf("Failed to create planObj %v", err)
	}

	serviceObj, err := dynamic.ObjectToMapInterface(_getDummyService())
	if err != nil {
		t.Errorf("Failed to create serviceObj %v", err)
	}

	type args struct {
		client   kubernetes.Client
		instance *osbv1alpha1.SFServiceInstance
		binding  *osbv1alpha1.SFServiceBinding
		service  *osbv1alpha1.SFService
		plan     *osbv1alpha1.SFPlan
	}
	tests := []struct {
		name    string
		args    args
		setup   func(args)
		cleanup func(args)
		want    map[string]interface{}
		wantErr bool
	}{
		{
			name: "fail if instance is nil",
			args: args{
				client:   c,
				instance: nil,
			},
			wantErr: true,
		},
		{
			name: "fail if plan is nil",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     nil,
			},
			wantErr: true,
		},
		{
			name: "fail if service is nil",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  nil,
			},
			wantErr: true,
		},
		{
			name: "fail if sources template is not found",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  _getDummyService(),
				binding:  _getDummyBinding(),
			},
			setup: func(a args) {
				a.plan.Spec.Templates = a.plan.Spec.Templates[:2]
			},
			wantErr: true,
		},
		{
			name: "fail if sources template has invalid type",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  _getDummyService(),
				binding:  _getDummyBinding(),
			},
			setup: func(a args) {
				a.plan.Spec.Templates[3].Type = "invalid"
			},
			wantErr: true,
		},
		{
			name: "fail if sources template input is invalid",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  _getDummyService(),
				binding:  _getDummyBinding(),
			},
			setup: func(a args) {
				a.plan.Spec.Templates[3].Type = "helm"
			},
			wantErr: true,
		},
		{
			name: "fail if sources template fails to render",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  _getDummyService(),
				binding:  _getDummyBinding(),
			},
			setup: func(a args) {
				a.plan.Spec.Templates[3].Content = `{{- $instanceID = "" }}`
			},
			wantErr: true,
		},
		{
			name: "fail if sources template fails to be parsed",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  _getDummyService(),
				binding:  _getDummyBinding(),
			},
			setup: func(a args) {
				a.plan.Spec.Templates[3].Content = `{{- $instanceID := "" }}
{{- $bindingID := "" }}
{{- with .instance.metadata.name }} {{ $instanceID = . }} {{ end }}
{{- with .binding.metadata.name }} {{ $bindingID = . }} {{ end }}
{{- $namespace := "default" }}
config:
 apiVersion: "v1"
  kind: ConfigMap
   name: {{ $instanceID }}
	namespace: {{ $namespace }}`
			},
			wantErr: true,
		},
		{
			name: "fetch sources resources",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  _getDummyService(),
				binding:  _getDummyBinding(),
			},
			cleanup: func(a args) {
				err := c.Delete(context.TODO(), configResource)
				if err != nil {
					t.Errorf("Failed to delete configmap %v", err)
				}
			},
			wantErr: false,
			want: map[string]interface{}{
				"service":  serviceObj,
				"plan":     planObj,
				"instance": instanceObj,
				"binding":  bindingObj,
				"config":   configResource.Object,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup(tt.args)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(tt.args)
			}
			got, err := computeInputObjects(tt.args.client, tt.args.instance, tt.args.binding, tt.args.service, tt.args.plan)
			if (err != nil) != tt.wantErr {
				t.Errorf("computeInputObjects() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("computeInputObjects() = %v, want %v", got, tt.want)
			}

		})
	}
}

func Test_renderTemplate(t *testing.T) {
	type args struct {
		client   kubernetes.Client
		instance *osbv1alpha1.SFServiceInstance
		binding  *osbv1alpha1.SFServiceBinding
		service  *osbv1alpha1.SFService
		plan     *osbv1alpha1.SFPlan
		action   string
	}
	tests := []struct {
		name    string
		args    args
		setup   func(args)
		cleanup func(args)
		want    renderer.Output
		wantErr bool
	}{
		{
			name: "fail if instance is nil",
			args: args{
				client:   c,
				instance: nil,
			},
			wantErr: true,
		},
		{
			name: "fail if plan is nil",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     nil,
			},
			wantErr: true,
		},
		{
			name: "fail if service is nil",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  nil,
			},
			wantErr: true,
		},
		{
			name: "fail if action template is not found",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  _getDummyService(),
				binding:  _getDummyBinding(),
				action:   "invalid",
			},
			wantErr: true,
		},
		{
			name: "fail if sources template is not found",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  _getDummyService(),
				binding:  _getDummyBinding(),
				action:   "provision",
			},
			setup: func(a args) {
				a.plan.Spec.Templates = a.plan.Spec.Templates[:2]
			},
			wantErr: true,
		},
		{
			name: "fail if action template is invalid type",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  _getDummyService(),
				binding:  _getDummyBinding(),
				action:   "provision",
			},
			setup: func(a args) {
				a.plan.Spec.Templates[0].Type = "invalid type3"
			},
			wantErr: true,
		},
		{
			name: "fail if action template fail to render",
			args: args{
				client:   c,
				instance: _getDummyInstance(),
				plan:     _getDummyPlan(),
				service:  _getDummyService(),
				binding:  _getDummyBinding(),
				action:   "provision",
			},
			setup: func(a args) {
				a.plan.Spec.Templates[0].Content = `{{- $instanceID = "" }}`
			},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup(tt.args)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(tt.args)
			}
			got, err := renderTemplate(tt.args.client, tt.args.instance, tt.args.binding, tt.args.service, tt.args.plan, tt.args.action)
			if (err != nil) != tt.wantErr {
				t.Errorf("renderTemplate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("renderTemplate() = %v, want %v", got, tt.want)
			}
		})
	}
}

func _getDummyInstance() *osbv1alpha1.SFServiceInstance {
	return &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "instance-id",
			Namespace: "default",
		},
		Spec: osbv1alpha1.SFServiceInstanceSpec{
			ServiceID: "service-id",
			PlanID:    "plan-id",
		},
		Status: osbv1alpha1.SFServiceInstanceStatus{
			DashboardURL: "",
			State:        "",
			Error:        "",
			Description:  "",
			Resources: []osbv1alpha1.Source{
				{
					APIVersion: "v1alpha1",
					Kind:       "Director",
					Name:       "dddd",
					Namespace:  "default",
				},
			},
		},
	}
}

func _getDummyBinding() *osbv1alpha1.SFServiceBinding {
	return &osbv1alpha1.SFServiceBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "binding-id",
			Namespace: "default",
		},
	}
}

func _getDummyService() *osbv1alpha1.SFService {
	return &osbv1alpha1.SFService{
		TypeMeta: metav1.TypeMeta{
			Kind:       "SFService",
			APIVersion: "osb.servicefabrik.io/v1alpha1",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "service-id",
			Namespace: "default",
			Labels:    map[string]string{"serviceId": "service-id"},
		},
		Spec: osbv1alpha1.SFServiceSpec{
			Name:                "service-name",
			ID:                  "service-id",
			Description:         "description",
			Tags:                []string{"foo", "bar"},
			Requires:            []string{"foo", "bar"},
			Bindable:            true,
			InstanceRetrievable: true,
			BindingRetrievable:  true,
			Metadata:            nil,
			DashboardClient: &osbv1alpha1.DashboardClient{
				ID:          "id",
				Secret:      "secret",
				RedirectURI: "redirecturi",
			},
			PlanUpdatable: true,
			RawContext:    nil,
		},
	}
}

func _getDummyPlan() *osbv1alpha1.SFPlan {
	templateSpec := []osbv1alpha1.TemplateSpec{
		{
			Action:  "provision",
			Type:    "gotemplate",
			Content: "provisionContent",
		},
		{
			Action:  "bind",
			Type:    "gotemplate",
			Content: "bindContent",
		},
		{
			Action:  "status",
			Type:    "gotemplate",
			Content: "statusContent",
		},
		{
			Action: "sources",
			Type:   "gotemplate",
			Content: `{{- $instanceID := "" }}
{{- $bindingID := "" }}
{{- with .instance.metadata.name }} {{ $instanceID = . }} {{ end }}
{{- with .binding.metadata.name }} {{ $bindingID = . }} {{ end }}
{{- $namespace := "default" }}
config:
  apiVersion: "v1"
  kind: ConfigMap
  name: {{ $instanceID }}
  namespace: {{ $namespace }}`,
		},
	}
	return &osbv1alpha1.SFPlan{
		TypeMeta: metav1.TypeMeta{
			Kind:       "SFPlan",
			APIVersion: "osb.servicefabrik.io/v1alpha1",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "plan-id",
			Namespace: "default",
			Labels:    map[string]string{"serviceId": "service-id", "planId": "plan-id"},
		},
		Spec: osbv1alpha1.SFPlanSpec{
			Name:          "plan-name",
			ID:            "plan-id",
			Description:   "description",
			Metadata:      nil,
			Free:          false,
			Bindable:      true,
			PlanUpdatable: true,
			Schemas:       nil,
			Templates:     templateSpec,
			ServiceID:     "service-id",
			RawContext:    nil,
			Manager:       nil,
		},
		Status: osbv1alpha1.SFPlanStatus{},
	}
}
