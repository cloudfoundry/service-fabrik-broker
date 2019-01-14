package factory

import (
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/onsi/gomega"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestGoTemplateRenderer(t *testing.T) {
	g := gomega.NewGomegaWithT(t)

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

	template, _ := plan.GetTemplate("provision")
	renderer, _ := GetRenderer(template.Type, nil)
	input, _ := GetRendererInput(template, &service, &plan, &instance, &binding, name)
	output, _ := renderer.Render(input)
	files, _ := output.ListFiles()
	content, _ := output.FileContent(files[0])

	g.Expect(len(files)).To(gomega.Equal(1))
	g.Expect(files[0]).To(gomega.Equal("main"))
	g.Expect(content).To(gomega.Equal("provisioncontent"))

	_, err := output.FileContent("nonmain")
	g.Expect(err).To(gomega.HaveOccurred())

	plan.Spec.Templates[0].Content = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYA"
	template2, _ := plan.GetTemplate("provision")
	input2, _ := GetRendererInput(template2, &service, &plan, &instance, &binding, name)
	g.Expect(input2).To(gomega.BeNil())

	plan.Spec.Templates[0].Content = ""
	template3, _ := plan.GetTemplate("provision")
	input3, _ := GetRendererInput(template3, &service, &plan, &instance, &binding, name)
	g.Expect(input3).To(gomega.BeNil())

	plan.Spec.Templates[0].Content = "provision | unknown_function"
	template4, _ := plan.GetTemplate("provision")
	renderer4, _ := GetRenderer(template4.Type, nil)
	input4, _ := GetRendererInput(template4, &service, &plan, &instance, &binding, name)
	output4, _ := renderer4.Render(input4)
	g.Expect(output4).To(gomega.BeNil())

}
