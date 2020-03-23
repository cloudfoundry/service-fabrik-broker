package factory

import (
	"reflect"
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/dynamic"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer/gotemplate"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer/helm"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

func TestGetRenderer(t *testing.T) {
	type args struct {
		rendererType string
		clientSet    *kubernetes.Clientset
	}

	helmRenderer, err := helm.New(nil)
	if err != nil {
		t.Errorf("GetRenderer() failed to create  helmRenderer error = %v", err)
	}
	gotemplateRenderer, err := gotemplate.New()
	if err != nil {
		t.Errorf("GetRenderer() failed to create  gotemplateRenderer error = %v", err)
	}
	tests := []struct {
		name    string
		args    args
		want    renderer.Renderer
		wantErr bool
	}{
		{
			name: "testValidInput",
			args: args{
				rendererType: "helm",
				clientSet:    nil,
			},
			want:    helmRenderer,
			wantErr: false,
		},
		{
			name: "testValidInputGotemplate",
			args: args{
				rendererType: "gotemplate",
				clientSet:    nil,
			},
			want:    gotemplateRenderer,
			wantErr: false,
		},
		{
			name: "testInvalidInput",
			args: args{
				rendererType: "abc",
				clientSet:    nil,
			},
			want:    nil,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := GetRenderer(tt.args.rendererType, tt.args.clientSet)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetRenderer() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if reflect.TypeOf(got) != reflect.TypeOf(tt.want) {
				t.Errorf("GetRenderer() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetRendererInput(t *testing.T) {
	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action:  "provision",
			Type:    "helm",
			URL:     "../helm/samples/postgresql",
			Content: "valuesTemplate:valuesTemplate",
		},
		osbv1alpha1.TemplateSpec{
			Action:  "status",
			Type:    "gotemplate",
			Content: "statusContent",
		},
		osbv1alpha1.TemplateSpec{
			Action:  "sources",
			Type:    "gotemplate",
			Content: "sourcesContent",
		},
	}
	plan := osbv1alpha1.SFPlan{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "plan-id",
			Namespace: "default",
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

	service := osbv1alpha1.SFService{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: "default",
		},
	}

	name := types.NamespacedName{
		Name:      "foo",
		Namespace: "default",
	}

	spec := osbv1alpha1.SFServiceInstanceSpec{}
	instance := osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: "default",
		},
		Spec: spec,
		Status: osbv1alpha1.SFServiceInstanceStatus{
			DashboardURL: "",
			State:        "",
			Error:        "",
			Description:  "",
			AppliedSpec:  spec,
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

	binding := osbv1alpha1.SFServiceBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: "default",
		},
	}

	invalidTemplate := osbv1alpha1.TemplateSpec{
		Action:  "provision",
		Type:    "invalidTemplate",
		Content: "provisioncontent%",
	}

	template, _ := plan.GetTemplate(osbv1alpha1.ProvisionAction)
	values := make(map[string]interface{})
	serviceObj, _ := dynamic.ObjectToMapInterface(service)
	values["service"] = serviceObj
	planObj, _ := dynamic.ObjectToMapInterface(plan)
	values["plan"] = planObj
	instanceObj, _ := dynamic.ObjectToMapInterface(instance)
	values["instance"] = instanceObj
	bindingObj, _ := dynamic.ObjectToMapInterface(binding)
	values["binding"] = bindingObj
	helmInput := helm.NewInput(template.URL, name.Name, name.Namespace, "valuesTemplate", values)

	type args struct {
		template *osbv1alpha1.TemplateSpec
		service  *osbv1alpha1.SFService
		plan     *osbv1alpha1.SFPlan
		instance *osbv1alpha1.SFServiceInstance
		binding  *osbv1alpha1.SFServiceBinding
		name     types.NamespacedName
	}
	tests := []struct {
		name    string
		args    args
		want    renderer.Input
		wantErr bool
	}{
		{
			name: "testValidInput",
			args: args{
				template: &templateSpec[0],
				service:  &service,
				plan:     &plan,
				instance: &instance,
				binding:  &binding,
				name:     name,
			},
			want:    helmInput,
			wantErr: false,
		},
		{
			name: "testInvalidInput",
			args: args{
				template: &invalidTemplate,
				service:  &service,
				plan:     &plan,
				instance: &instance,
				binding:  &binding,
				name:     name,
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "testInvalidInput fail to decode ContentEncoded",
			args: args{
				template: &osbv1alpha1.TemplateSpec{
					Action:         "provision",
					Type:           "gotemplate",
					ContentEncoded: "invalid bas64 content",
				},
				service:  &service,
				plan:     &plan,
				instance: &instance,
				binding:  &binding,
				name:     name,
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "testInvalidInput no content and ContentEncoded",
			args: args{
				template: &osbv1alpha1.TemplateSpec{
					Action: "provision",
					Type:   "gotemplate",
				},
				service:  &service,
				plan:     &plan,
				instance: &instance,
				binding:  &binding,
				name:     name,
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "testValidInput gotemplate ContentEncoded",
			args: args{
				template: &osbv1alpha1.TemplateSpec{
					Action:         "provision",
					Type:           "gotemplate",
					ContentEncoded: "Q29udGVudEVuY29kZWQK", // ContentEncoded
				},
				service:  &service,
				plan:     &plan,
				instance: &instance,
				binding:  &binding,
				name:     name,
			},
			want:    gotemplate.NewInput("", "ContentEncoded", name.Name, values),
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := GetRendererInput(tt.args.template, tt.args.service, tt.args.plan, tt.args.instance, tt.args.binding, tt.args.name)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetRendererInput() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if reflect.TypeOf(got) != reflect.TypeOf(tt.want) {
				t.Errorf("GetRendererInput() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetRendererInputFromSources(t *testing.T) {
	name := types.NamespacedName{
		Name:      "foo",
		Namespace: "default",
	}

	invalidTemplate := osbv1alpha1.TemplateSpec{
		Action: "provision",
		Type:   "invalidTemplate",
		//Content: `{{ (printf "{ (b64enc \"provisioncontent\" | quote) }" ) }}`,
		Content: "provisioncontent",
	}

	type args struct {
		template *osbv1alpha1.TemplateSpec
		name     types.NamespacedName
		sources  map[string]interface{}
	}
	sources := make(map[string]interface{})
	sources["key"] = make(map[string]interface{})

	tests := []struct {
		name    string
		args    args
		want    renderer.Input
		wantErr bool
	}{
		{
			name: "testInvalidInput",
			args: args{
				template: &invalidTemplate,
				name:     name,
				sources:  sources,
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "testValidInputGoTemplate with ContentEncoded",
			args: args{
				template: &osbv1alpha1.TemplateSpec{
					Action:         "status",
					Type:           "gotemplate",
					ContentEncoded: "c3RhdHVzY29udGVudA==", //statuscontent
				},
				name:    name,
				sources: nil,
			},
			want:    gotemplate.NewInput("", "statuscontent", "foo", nil),
			wantErr: false,
		},
		{
			name: "testValidInputGoTemplate with content",
			args: args{
				template: &osbv1alpha1.TemplateSpec{
					Action:  "status",
					Type:    "gotemplate",
					Content: "statuscontent", //statuscontent
				},
				name:    name,
				sources: nil,
			},
			want:    gotemplate.NewInput("", "statuscontent", "foo", nil),
			wantErr: false,
		},
		{
			name: "testInvalidInput fail to decode ContentEncoded",
			args: args{
				template: &osbv1alpha1.TemplateSpec{
					Action:         "status",
					Type:           "gotemplate",
					ContentEncoded: "invalid bas64 content",
				},
				name:    name,
				sources: nil,
			},
			want:    nil,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := GetRendererInputFromSources(tt.args.template, tt.args.name, tt.args.sources)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetRendererInputFromSources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if reflect.TypeOf(got) != reflect.TypeOf(tt.want) {
				t.Errorf("GetRendererInputFromSources() = %v, want %v", got, tt.want)
			}
		})
	}
}
