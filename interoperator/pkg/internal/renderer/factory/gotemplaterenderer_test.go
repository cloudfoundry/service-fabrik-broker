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

	plan.Spec.Templates[0].ContentEncoded = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYA"
	template2, _ := plan.GetTemplate("provision")
	input2, _ := GetRendererInput(template2, &service, &plan, &instance, &binding, name)
	g.Expect(input2).To(gomega.BeNil())

	plan.Spec.Templates[0].ContentEncoded = ""
	template3, _ := plan.GetTemplate("provision")
	input3, _ := GetRendererInput(template3, &service, &plan, &instance, &binding, name)
	g.Expect(input3).To(gomega.BeNil())

	plan.Spec.Templates[0].ContentEncoded = "e3sgInByb3Zpc2lvbiIgfCB1bmtub3duX2Z1bmN0aW9uIH19" //{{ "provision" | unknown_function }}
	template4, _ := plan.GetTemplate("provision")
	renderer4, _ := GetRenderer(template4.Type, nil)
	input4, _ := GetRendererInput(template4, &service, &plan, &instance, &binding, name)
	output4, _ := renderer4.Render(input4)
	g.Expect(output4).To(gomega.BeNil())

	plan.Spec.Templates[0].ContentEncoded = "provision | unknown_function" //{{ "provision" | unknown_function }}
	template5, _ := plan.GetTemplate("provision")
	renderer5, _ := GetRenderer(template5.Type, nil)
	input5, _ := GetRendererInput(template5, &service, &plan, &instance, &binding, name)
	output5, _ := renderer5.Render(input5)
	g.Expect(output5).To(gomega.BeNil())

	plan.Spec.Templates[0].Content = "provisioncontent"
	template6, _ := plan.GetTemplate("provision")
	renderer6, _ := GetRenderer(template6.Type, nil)
	input6, _ := GetRendererInput(template6, &service, &plan, &instance, &binding, name)
	output6, _ := renderer6.Render(input6)
	files6, _ := output6.ListFiles()
	content6, _ := output6.FileContent(files6[0])

	g.Expect(len(files)).To(gomega.Equal(1))
	g.Expect(files[0]).To(gomega.Equal("main"))
	g.Expect(content6).To(gomega.Equal("provisioncontent"))
}
