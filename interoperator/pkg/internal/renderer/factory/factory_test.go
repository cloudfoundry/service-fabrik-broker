package factory

import (
	"os"
	"reflect"
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/dynamic"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/properties"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer/gotemplate"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer/helm"
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

	helmRenderer, _ := helm.New(nil)
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
			wantErr: true,
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
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("GetRenderer() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGetRendererInput(t *testing.T) {
	gopath := os.Getenv("GOPATH")
	if gopath == "" {
		gopath = "/home/travis/gopath"
	}

	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action: "provision",
			Type:   "helm",
			URL:    gopath + "/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/config/samples/templates/helmtemplates/postgresql",
		},
		osbv1alpha1.TemplateSpec{
			Action: "properties",
			Type:   "helm",
			URL:    gopath + "/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/config/samples/templates/helmtemplates/postgresqlProperties",
		},
		osbv1alpha1.TemplateSpec{
			Action: "sources",
			Type:   "helm",
			URL:    gopath + "/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/config/samples/templates/helmtemplates/postgresqlProperties",
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
		Action: "provision",
		Type:   "invalidTemplate",
		//Content: `{{ (printf "{ (b64enc \"provisioncontent\" | quote) }" ) }}`,
		Content: "cHJvdmlzaW9uY29udGVudA==",
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
	helmInput := helm.NewInput(template.URL, name.Name, name.Namespace, values)

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
	gopath := os.Getenv("GOPATH")
	if gopath == "" {
		gopath = "/home/travis/gopath"
	}

	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action: "provision",
			Type:   "helm",
			URL:    gopath + "/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/config/samples/templates/helmtemplates/postgresql",
		},
		osbv1alpha1.TemplateSpec{
			Action: "properties",
			Type:   "helm",
			URL:    gopath + "/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/config/samples/templates/helmtemplates/postgresqlProperties",
		},
		osbv1alpha1.TemplateSpec{
			Action: "sources",
			Type:   "helm",
			URL:    gopath + "/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/config/samples/templates/helmtemplates/postgresqlProperties",
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

	templateSpec2 := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action: "provision",
			Type:   "gotemplate",
			//Content: `{{ (printf "{ (b64enc \"provisioncontent\" | quote) }" ) }}`,
			ContentEncoded: "cHJvdmlzaW9uY29udGVudA==",
		},
		osbv1alpha1.TemplateSpec{
			Action:         "bind",
			Type:           "gotemplate",
			ContentEncoded: "YmluZGNvbnRlbnQ=",
		},
		osbv1alpha1.TemplateSpec{
			Action:         "properties",
			Type:           "gotemplate",
			ContentEncoded: "cHJvcGVydGllc2NvbnRlbnQ=",
		},
		osbv1alpha1.TemplateSpec{
			Action:         "sources",
			Type:           "gotemplate",
			ContentEncoded: "c291cmNlc2NvbnRlbnQ=",
		},
	}
	plan2 := osbv1alpha1.SFPlan{
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
			Templates:     templateSpec2,
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

	template, _ := plan.GetTemplate(osbv1alpha1.SourcesAction)
	clientSet, _ := kubernetes.NewForConfig(cfg)
	rendererObj, _ := GetRenderer(template.Type, clientSet)
	input, _ := GetRendererInput(template, &service, &plan, &instance, &binding, name)
	output, _ := rendererObj.Render(input)
	files, _ := output.ListFiles()
	sourcesFileName := files[0]
	for _, file := range files {
		if file == "sources.yaml" {
			sourcesFileName = file
			break
		}
	}
	sourcesString, _ := output.FileContent(sourcesFileName)
	sources, _ := properties.ParseSources(sourcesString)
	sourceObjects := make(map[string]*unstructured.Unstructured)
	for key, val := range sources {
		if val.Name != "" {
			obj := &unstructured.Unstructured{}
			obj.SetKind(val.Kind)
			obj.SetAPIVersion(val.APIVersion)
			sourceObjects[key] = obj
		}
	}

	values := make(map[string]interface{})
	for key, val := range sourceObjects {
		values[key] = val.Object
	}

	helmInput := helm.NewInput(template.URL, name.Name, name.Namespace, values)

	template2, _ := plan2.GetTemplate(osbv1alpha1.SourcesAction)
	rendererObj2, _ := GetRenderer(template2.Type, nil)
	input2, _ := GetRendererInput(template2, &service, &plan, &instance, &binding, name)
	output2, _ := rendererObj2.Render(input2)
	files2, _ := output2.ListFiles()
	sourcesFileName2 := files2[0]
	for _, file := range files2 {
		if file == "sources.yaml" {
			sourcesFileName2 = file
			break
		}
	}
	sourcesString2, _ := output2.FileContent(sourcesFileName2)
	sources2, _ := properties.ParseSources(sourcesString2)
	sourceObjects2 := make(map[string]*unstructured.Unstructured)
	for key, val := range sources2 {
		if val.Name != "" {
			obj := &unstructured.Unstructured{}
			obj.SetKind(val.Kind)
			obj.SetAPIVersion(val.APIVersion)
			sourceObjects2[key] = obj
		}
	}

	values2 := make(map[string]interface{})
	for key, val := range sourceObjects2 {
		values2[key] = val.Object
	}

	//gotemplateInput := gotemplate.NewInput(template.URL, template.Content, name.Name, values)

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
		{
			name: "testValidInputHelm",
			args: args{
				template: &templateSpec[2],
				name:     name,
				sources:  sourceObjects,
			},
			want:    helmInput,
			wantErr: false,
		},
		{
			name: "testValidInputGoTemplate",
			args: args{
				template: &templateSpec2[2],
				name:     name,
				sources:  sourceObjects2,
			},
			want:    gotemplate.NewInput(template.URL, "propertiescontent", "foo", values2),
			wantErr: false,
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
