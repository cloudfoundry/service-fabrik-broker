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

func TestStorageSFService(t *testing.T) {
	key := types.NamespacedName{
		Name:      "foo",
		Namespace: constants.InteroperatorNamespace,
	}
	parameters := `{
		"foo": "bar",
		"abc": {
			"description": "some description for abc field"
		}
	}`
	re := &runtime.RawExtension{}
	_ = re.UnmarshalJSON([]byte(parameters))

	created := &SFService{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: constants.InteroperatorNamespace,
		},
		Spec: SFServiceSpec{
			Name:                "service-name",
			ID:                  "service-id",
			Description:         "description",
			Tags:                []string{"foo", "bar"},
			Requires:            []string{"foo", "bar"},
			Bindable:            true,
			InstanceRetrievable: true,
			BindingRetrievable:  true,
			Metadata:            re,
			DashboardClient: &DashboardClient{
				ID:          "id",
				Secret:      "secret",
				RedirectURI: "redirecturi",
			},
			PlanUpdatable: true,
			RawContext:    re,
		},
		Status: SFServiceStatus{},
	}
	g := gomega.NewGomegaWithT(t)

	// Test Create
	fetched := &SFService{}
	g.Expect(c.Create(context.TODO(), created)).NotTo(gomega.HaveOccurred())

	g.Expect(c.Get(context.TODO(), key, fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(fetched).To(gomega.Equal(created))

	// Test Updating the Labels
	updatedObject := fetched.DeepCopyObject()
	updated := updatedObject.(*SFService)
	updated.Labels = map[string]string{"hello": "world"}
	g.Expect(c.Update(context.TODO(), updated)).NotTo(gomega.HaveOccurred())

	g.Expect(c.Get(context.TODO(), key, fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(fetched).To(gomega.Equal(updated))

	// Test listing
	serviceList := &SFServiceList{}
	options := &kubernetes.ListOptions{
		Namespace: constants.InteroperatorNamespace,
	}
	labels := make(kubernetes.MatchingLabels)
	labels["hello"] = "world"
	labels.ApplyToList(options)
	g.Expect(c.List(context.TODO(), serviceList, options)).NotTo(gomega.HaveOccurred())
	g.Expect(len(serviceList.Items)).To(gomega.Equal(1))

	// Test deepcopy SFServiceList
	copiedListObject := serviceList.DeepCopyObject()
	copiedList := copiedListObject.(*SFServiceList)
	g.Expect(copiedList).To(gomega.Equal(serviceList))

	//Test deepcopy SFServiceSpec, SFServiceStatus and DashboardClient
	copiedSpec := updated.Spec.DeepCopy()
	g.Expect(copiedSpec).To(gomega.Equal(&updated.Spec))
	copiedStatus := updated.Status.DeepCopy()
	g.Expect(copiedStatus).To(gomega.Equal(&updated.Status))
	copiedDashboardClient := updated.Spec.DashboardClient.DeepCopy()
	g.Expect(copiedDashboardClient.ID).To(gomega.Equal(updated.Spec.DashboardClient.ID))
	g.Expect(copiedDashboardClient.Secret).To(gomega.Equal(updated.Spec.DashboardClient.Secret))
	g.Expect(copiedDashboardClient.RedirectURI).To(gomega.Equal(updated.Spec.DashboardClient.RedirectURI))

	// Test Delete
	g.Expect(c.Delete(context.TODO(), fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Get(context.TODO(), key, fetched)).To(gomega.HaveOccurred())
}
