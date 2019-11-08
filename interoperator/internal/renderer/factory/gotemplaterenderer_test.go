package factory

import (
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
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
			Action:         "status",
			Type:           "gotemplate",
			ContentEncoded: "c3RhdHVzY29udGVudA==",
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

	plan.Spec.Templates[2].ContentEncoded = `e3sgJG5hbWUgOj0gIiIgfX0Ke3stIHdpdGggLnBvc3RncmVzcWxtdC5tZXRhZGF0YS5uYW1lIH19CiAge3stICRuYW1lID0gLiB9fQp7ey0gZW5kIH19Cnt7LSAkc3RhdGVTdHJpbmcgOj0gImluX3F1ZXVlIiB9fQp7ey0gJHJlc3BvbnNlIDo9ICIiIH19Cnt7LSAkZXJyb3IgOj0gIiIgfX0Ke3stIHdpdGggLnBvc3RncmVzcWxtdC5zdGF0dXMgfX0KICB7ey0gaWYgZXEgLnN0YXRlICJzdWNjZWVkZWQiIH19CiAgICB7ey0gJHN0YXRlU3RyaW5nID0gInN1Y2NlZWRlZCIgfX0KICAgIHt7LSAkcmVzcG9uc2UgPSAkcmVzcG9uc2UgfX0KICB7ey0gZWxzZSB9fQogICAge3stIGlmIGVxIC5zdGF0ZSAiZmFpbGVkIn19CiAgICAgIHt7LSAkc3RhdGVTdHJpbmcgPSAiZmFpbGVkIiB9fQogICAgICB7ey0gJGVycm9yID0gIC5lcnJvciB9fQogICAge3stIGVuZCB9fQogIHt7LSBlbmQgfX0Ke3stIGVuZCB9fQp7ey0gaWYgZXEgJHN0YXRlU3RyaW5nICJzdWNjZWVkZWQiIH19CiAge3stICRyZXNwb25zZSA9IChwcmludGYgIlNlcnZpY2UgSW5zdGFuY2UgJXMgY3JlYXRpb24gc3VjY2Vzc2Z1bGwiICRuYW1lKSB9fQp7ey0gZWxzZSB9fQogICAge3stICRyZXNwb25zZSA9IChwcmludGYgIlNlcnZpY2UgSW5zdGFuY2UgJXMgcHJvdmlzaW9uIGZhaWxlZCIgJG5hbWUpIH19Cnt7LSBlbmQgfX0Ke3stIGlmIGVxICRzdGF0ZVN0cmluZyAiaW5fcXVldWUiIH19CiAge3stICRyZXNwb25zZSA9ICIiIH19Cnt7LSBlbmQgfX0KcHJvdmlzaW9uOgogIHN0YXRlOiB7eyAkc3RhdGVTdHJpbmcgfX0KICByZXNwb25zZToge3sgJHJlc3BvbnNlIH19Cnt7LSBpZiBlcSAkc3RhdGVTdHJpbmcgImZhaWxlZCIgfX0KICBlcnJvcjoge3sgJGVycm9yIHwgcXVvdGV9fQp7ey0gZW5kIH19CiAgZGFzaGJvYXJkVXJsOiAiIgp7ey0gd2l0aCAucG9zdGdyZXNxbG10YmluZC5zdGF0dXMgfX0KICB7ey0gJHJlc3BvbnNlID0gKGI2NGRlYyAucmVzcG9uc2UgfCBxdW90ZSkgfX0Ke3stIGVuZCB9fQp7ey0gJHN0YXRlU3RyaW5nID0gImluX3F1ZXVlIiB9fSAKe3stIHdpdGggLnBvc3RncmVzcWxtdGJpbmQgfX0KICB7ey0gd2l0aCAuc3RhdHVzIH19CiAgICB7ey0gaWYgZXEgLnN0YXRlICJzdWNjZWVkZWQiIH19CiAgICAgIHt7LSAkc3RhdGVTdHJpbmcgPSAic3VjY2VlZGVkIiB9fQogICAge3stIGVsc2UgfX0KICAgICAge3stIGlmIGVxIC5zdGF0ZSAiZmFpbGVkIiB9fQogICAgICAgIHt7LSAkc3RhdGVTdHJpbmcgPSAiZmFpbGVkIiB9fQogICAgICAgIHt7LSAkZXJyb3IgPSAgLmVycm9yIH19CiAgICAgIHt7LSBlbmQgfX0KICAgIHt7LSBlbmQgfX0KICB7ey0gZW5kIH19Cnt7LSBlbmQgfX0KYmluZDoKICBzdGF0ZToge3sgJHN0YXRlU3RyaW5nIH19Cnt7LSBpZiBlcSAkc3RhdGVTdHJpbmcgImZhaWxlZCIgfX0KICBlcnJvcjoge3sgJGVycm9yIHwgcXVvdGV9fQp7ey0gZW5kIH19CiAgcmVzcG9uc2U6IHt7ICRyZXNwb25zZSB9fQp7ey0gd2l0aCAucG9zdGdyZXNxbG10YmluZC5zdGF0dXMgfX0KICB7ey0gJHJlc3BvbnNlID0gKGI2NGRlYyAucmVzcG9uc2UgfCBxdW90ZSkgfX0Ke3stIGVuZCB9fQp7ey0gJHN0YXRlU3RyaW5nID0gImRlbGV0ZSIgfX0gCnt7LSB3aXRoIC5wb3N0Z3Jlc3FsbXRiaW5kIH19CiAge3stIHdpdGggLnN0YXR1cyB9fQogICAge3stIGlmIGVxIC5zdGF0ZSAic3VjY2VlZGVkIiB9fQogICAgICB7ey0gJHN0YXRlU3RyaW5nID0gInN1Y2NlZWRlZCIgfX0KICAgIHt7LSBlbHNlIH19CiAgICAgIHt7LSBpZiBlcSAuc3RhdGUgImZhaWxlZCIgfX0KICAgICAgICB7ey0gJHN0YXRlU3RyaW5nID0gImZhaWxlZCIgfX0KICAgICAgICB7ey0gJGVycm9yID0gIC5lcnJvciB9fQogICAgICB7ey0gZW5kIH19CiAgICB7ey0gZW5kIH19CiAge3stIGVuZCB9fQp7ey0gZWxzZSB9fQogIHt7LSAkc3RhdGVTdHJpbmcgPSAic3VjY2VlZGVkIiB9fQp7ey0gZW5kIH19CnVuYmluZDoKICBzdGF0ZToge3sgJHN0YXRlU3RyaW5nIH19Cnt7LSBpZiBlcSAkc3RhdGVTdHJpbmcgImZhaWxlZCIgfX0KICBlcnJvcjoge3sgJGVycm9yIHwgcXVvdGV9fQp7ey0gZW5kIH19CiAgcmVzcG9uc2U6IHt7ICRyZXNwb25zZSB9fQp7ey0gJHJlc3BvbnNlIDo9ICIiIH19Cnt7LSAkc3RhdGVTdHJpbmcgPSAiZGVsZXRlIiB9fSAKe3stIHdpdGggLnBvc3RncmVzcWxtdCB9fQogIHt7LSB3aXRoIC5zdGF0dXMgfX0KICAgIHt7LSBpZiBlcSAuc3RhdGUgImRlbGV0ZSIgfX0KICAgICAge3stICRzdGF0ZVN0cmluZyA9ICJkZWxldGUiIH19CiAgICB7ey0gZWxzZSB9fQogICAgICB7ey0gaWYgZXEgLnN0YXRlICJmYWlsZWQiIH19CiAgICAgICAge3stICRzdGF0ZVN0cmluZyA9ICJmYWlsZWQiIH19CiAgICAgICAge3stICRlcnJvciA9ICAuZXJyb3IgfX0KICAgICAge3stIGVuZCB9fQogICAge3stIGVuZCB9fQogIHt7LSBlbmQgfX0Ke3stIGVsc2UgfX0KICB7ey0gJHN0YXRlU3RyaW5nID0gInN1Y2NlZWRlZCIgfX0Ke3stIGVuZCB9fQpkZXByb3Zpc2lvbjoKICBzdGF0ZToge3sgJHN0YXRlU3RyaW5nIH19Cnt7LSBpZiBlcSAkc3RhdGVTdHJpbmcgImZhaWxlZCIgfX0KICBlcnJvcjoge3sgJGVycm9yIHwgcXVvdGV9fQp7ey0gZW5kIH19CiAgcmVzcG9uc2U6IHt7ICRyZXNwb25zZSB9fQo=`
	template7, _ := plan.GetTemplate("status")
	renderer7, _ := GetRenderer(template7.Type, nil)
	input7, err7 := GetRendererInput(template7, &service, &plan, &instance, &binding, name)
	output7, err8 := renderer7.Render(input7)
	files7, err9 := output7.ListFiles()
	_, err10 := output7.FileContent(files7[0])
	g.Expect(err7).NotTo(gomega.HaveOccurred())
	g.Expect(err8).NotTo(gomega.HaveOccurred())
	g.Expect(err9).NotTo(gomega.HaveOccurred())
	g.Expect(err10).NotTo(gomega.HaveOccurred())

	g.Expect(len(files7)).To(gomega.Equal(1))
	g.Expect(files7[0]).To(gomega.Equal("main"))
	//g.Expect(content7).To(gomega.Equal("provisioncontent"))
}
