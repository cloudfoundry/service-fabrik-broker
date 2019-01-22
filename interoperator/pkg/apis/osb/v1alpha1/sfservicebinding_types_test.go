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
	"testing"

	"github.com/onsi/gomega"
	"golang.org/x/net/context"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	runtime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
)

func TestStorageSFServiceBinding(t *testing.T) {
	key := types.NamespacedName{
		Name:      "foo",
		Namespace: "default",
	}
	parameters := `{
		"foo": "bar",
		"abc": {
			"description": "some description for abc field"
		}
	}`
	re := &runtime.RawExtension{}
	_ = re.UnmarshalJSON([]byte(parameters))

	created := &SFServiceBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: "default",
		},
		Spec: SFServiceBindingSpec{
			ID:                "binding-id",
			InstanceID:        "instance-id",
			PlanID:            "plan-id",
			ServiceID:         "service-id",
			AppGUID:           "app-guid",
			BindResource:      re,
			RawContext:        re,
			RawParameters:     re,
			AcceptsIncomplete: true,
		},
		Status: SFServiceBindingStatus{
			Response: BindingResponse{
				SecretRef: "secret-ref",
			},
			Resources: []Source{
				Source{
					APIVersion: "apiversion",
					Kind:       "kind",
					Name:       "name",
					Namespace:  "namespace",
				},
			},
		},
	}
	g := gomega.NewGomegaWithT(t)

	// Test Create
	fetched := &SFServiceBinding{}
	g.Expect(c.Create(context.TODO(), created)).NotTo(gomega.HaveOccurred())

	g.Expect(c.Get(context.TODO(), key, fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(fetched).To(gomega.Equal(created))

	// Test Updating the Labels
	updatedObject := fetched.DeepCopyObject()
	updated := updatedObject.(*SFServiceBinding)
	updated.Labels = map[string]string{"hello": "world"}
	g.Expect(c.Update(context.TODO(), updated)).NotTo(gomega.HaveOccurred())

	g.Expect(c.Get(context.TODO(), key, fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(fetched).To(gomega.Equal(updated))

	// Test listing
	bindingList := &SFServiceBindingList{}
	labels := make(map[string]string)
	labels["hello"] = "world"
	options := kubernetes.MatchingLabels(labels)
	options.Namespace = "default"
	g.Expect(c.List(context.TODO(), options, bindingList)).NotTo(gomega.HaveOccurred())
	g.Expect(len(bindingList.Items)).To(gomega.Equal(1))

	// Test deepcopy SFServiceBindingList
	copiedListObject := bindingList.DeepCopyObject()
	copiedList := copiedListObject.(*SFServiceBindingList)
	g.Expect(copiedList).To(gomega.Equal(bindingList))

	//Test deepcopy SFServiceBindingSpec & SFServiceBindingStatus
	copiedSpec := updated.Spec.DeepCopy()
	g.Expect(copiedSpec).To(gomega.Equal(&updated.Spec))
	copiedStatus := updated.Status.DeepCopy()
	g.Expect(copiedStatus).To(gomega.Equal(&updated.Status))

	//Test deepcopy BindingResponse
	copiedResponse := updated.Status.Response.DeepCopy()
	g.Expect(copiedResponse).To(gomega.Equal(&updated.Status.Response))

	// Test Delete
	g.Expect(c.Delete(context.TODO(), fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Get(context.TODO(), key, fetched)).To(gomega.HaveOccurred())
}
