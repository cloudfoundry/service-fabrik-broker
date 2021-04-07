/*
Copyright 2018 The Service Fabrik Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package v1alpha1

import (
	"context"
	"testing"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/onsi/gomega"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	runtime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
)

func TestStorageSfPlan(t *testing.T) {
	templateSpec := []TemplateSpec{
		TemplateSpec{
			Action:  "provision",
			Type:    "gotemplate",
			Content: "provisioncontent",
		},
		TemplateSpec{
			Action:  "bind",
			Type:    "gotemplate",
			Content: "bindcontent",
		},
		TemplateSpec{
			Action:  "status",
			Type:    "gotemplate",
			Content: "statuscontent",
		},
		TemplateSpec{
			Action:  "sources",
			Type:    "gotemplate",
			Content: "sourcescontent",
		},
		TemplateSpec{
			Action:  "unbind",
			Type:    "gotemplate",
			Content: "unbindcontent",
		},
	}
	key := types.NamespacedName{
		Name:      "plan-id",
		Namespace: constants.InteroperatorNamespace,
	}
	parameters := `{
		"$schema": "http://json-schema.org/draft-06/schema#",
		"title": "createServiceInstance",
		"type": "object",
		"additionalProperties": false,
		"properties": null,
		"foo": {
			"type": "string",
			"description": "some description for foo field"
		},
		"required": [
			"foo"
		]
	}`
	re := &runtime.RawExtension{}
	_ = re.UnmarshalJSON([]byte(parameters))
	schema := Schema{
		Parameters: re,
	}
	schemas := &ServiceSchemas{
		Instance: ServiceInstanceSchema{
			Create: &schema,
			Update: &schema,
		},
		Binding: ServiceBindingSchema{
			Create: &schema,
		},
	}
	created := &SFPlan{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "plan-id",
			Namespace: constants.InteroperatorNamespace,
		},
		Spec: SFPlanSpec{
			Name:                   "plan-name",
			ID:                     "plan-id",
			Description:            "description",
			Metadata:               re,
			Free:                   false,
			Bindable:               true,
			PlanUpdatable:          true,
			AutoUpdateInstances:    false,
			Schemas:                schemas,
			Templates:              templateSpec,
			ServiceID:              "service-id",
			MaximumPollingDuration: 10,
			RawContext:             re,
			Manager:                re,
		},
		Status: SFPlanStatus{},
	}
	g := gomega.NewGomegaWithT(t)

	// Test Create
	fetched := &SFPlan{}
	g.Expect(c.Create(context.TODO(), created)).NotTo(gomega.HaveOccurred())

	g.Expect(c.Get(context.TODO(), key, fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(fetched).To(gomega.Equal(created))

	provisionTemplate, _ := fetched.GetTemplate("provision")
	g.Expect(provisionTemplate.Content).To(gomega.Equal("provisioncontent"))

	_, err := fetched.GetTemplate("unknown")
	g.Expect(err).To(gomega.HaveOccurred())

	// Test Updating the Labels
	updatedObject := fetched.DeepCopyObject()
	updated := updatedObject.(*SFPlan)
	updated.Labels = map[string]string{"hello": "world"}
	g.Expect(c.Update(context.TODO(), updated)).NotTo(gomega.HaveOccurred())

	g.Expect(c.Get(context.TODO(), key, fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(fetched).To(gomega.Equal(updated))

	// Test listing
	planList := &SFPlanList{}
	options := &kubernetes.ListOptions{
		Namespace: constants.InteroperatorNamespace,
	}
	labels := make(kubernetes.MatchingLabels)
	labels["hello"] = "world"
	labels.ApplyToList(options)
	g.Expect(c.List(context.TODO(), planList, options)).NotTo(gomega.HaveOccurred())
	g.Expect(len(planList.Items)).To(gomega.Equal(1))

	// Test deepcopy SFPlanList
	copiedListObject := planList.DeepCopyObject()
	copiedList := copiedListObject.(*SFPlanList)
	g.Expect(copiedList).To(gomega.Equal(planList))

	//Test deepcopy SFPlanSpec & SFPlanStatus
	copiedSpec := updated.Spec.DeepCopy()
	g.Expect(copiedSpec).To(gomega.Equal(&updated.Spec))
	copiedStatus := updated.Status.DeepCopy()
	g.Expect(copiedStatus).To(gomega.Equal(&updated.Status))

	//Test deepcopy
	copiedSchemas := schemas.DeepCopy()
	g.Expect(copiedSchemas).To(gomega.Equal(schemas))
	copiedInstanceSchema := schemas.Instance.DeepCopy()
	g.Expect(copiedInstanceSchema).To(gomega.Equal(&schemas.Instance))
	copiedBindingSchemas := schemas.Binding.DeepCopy()
	g.Expect(copiedBindingSchemas).To(gomega.Equal(&schemas.Binding))
	copiedSchema := schema.DeepCopy()
	g.Expect(copiedSchema).To(gomega.Equal(&schema))
	copiedTemplateSpec := templateSpec[0].DeepCopy()
	g.Expect(copiedTemplateSpec).To(gomega.Equal(&templateSpec[0]))

	// Test Delete
	g.Expect(c.Delete(context.TODO(), fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Get(context.TODO(), key, fetched)).To(gomega.HaveOccurred())
}
