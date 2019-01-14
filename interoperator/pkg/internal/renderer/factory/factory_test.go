package factory

import (
	"reflect"
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

func TestGetRenderer(t *testing.T) {
	type args struct {
		rendererType string
		clientSet    *kubernetes.Clientset
	}
	tests := []struct {
		name    string
		args    args
		want    renderer.Renderer
		wantErr bool
	}{
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
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("GetRenderer() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetRendererInput(t *testing.T) {

	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action: "provision",
			Type:   "gotemplate",
			//Content: `{{ (printf "{ (b64enc \"provisioncontent\" | quote) }" ) }}`,
			Content: "cHJvdmlzaW9uY29udGVudA==",
		},
		osbv1alpha1.TemplateSpec{
			Action:  "bind",
			Type:    "gotemplate",
			Content: "YmluZGNvbnRlbnQ=",
		},
		osbv1alpha1.TemplateSpec{
			Action:  "properties",
			Type:    "gotemplate",
			Content: "cHJvcGVydGllc2NvbnRlbnQ=",
		},
		osbv1alpha1.TemplateSpec{
			Action:  "sources",
			Type:    "gotemplate",
			Content: "c291cmNlc2NvbnRlbnQ=",
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
			CRDs: []osbv1alpha1.Source{
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
		Action: "provision",
		Type:   "invalidTemplate",
		//Content: `{{ (printf "{ (b64enc \"provisioncontent\" | quote) }" ) }}`,
		Content: "cHJvdmlzaW9uY29udGVudA==",
	}

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
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := GetRendererInput(tt.args.template, tt.args.service, tt.args.plan, tt.args.instance, tt.args.binding, tt.args.name)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetRendererInput() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("GetRendererInput() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetPropertiesRendererInput(t *testing.T) {

	name := types.NamespacedName{
		Name:      "foo",
		Namespace: "default",
	}

	invalidTemplate := osbv1alpha1.TemplateSpec{
		Action: "provision",
		Type:   "invalidTemplate",
		//Content: `{{ (printf "{ (b64enc \"provisioncontent\" | quote) }" ) }}`,
		Content: "cHJvdmlzaW9uY29udGVudA==",
	}

	type args struct {
		template *osbv1alpha1.TemplateSpec
		name     types.NamespacedName
		sources  map[string]*unstructured.Unstructured
	}
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
				sources:  nil,
			},
			want:    nil,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := GetPropertiesRendererInput(tt.args.template, tt.args.name, tt.args.sources)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetPropertiesRendererInput() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("GetPropertiesRendererInput() = %v, want %v", got, tt.want)
			}
		})
	}
}
