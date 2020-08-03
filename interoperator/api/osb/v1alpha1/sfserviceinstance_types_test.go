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

func TestStorageServiceInstance(t *testing.T) {
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

	spec := SFServiceInstanceSpec{
		ServiceID:        "service-id",
		PlanID:           "plan-id",
		RawContext:       re,
		OrganizationGUID: "org-id",
		SpaceGUID:        "space-id",
		RawParameters:    re,
		PreviousValues:   re,
	}
	created := &SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: constants.InteroperatorNamespace,
		},
		Spec: spec,
		Status: SFServiceInstanceStatus{
			DashboardURL: "",
			State:        "",
			Error:        "",
			Description:  "",
			AppliedSpec:  spec,
			Resources: []Source{
				{
					APIVersion: "v1alpha1",
					Kind:       "Director",
					Name:       "dddd",
					Namespace:  constants.InteroperatorNamespace,
				},
			},
		},
	}
	g := gomega.NewGomegaWithT(t)

	// Test Create
	fetched := &SFServiceInstance{}
	g.Expect(c.Create(context.TODO(), created)).NotTo(gomega.HaveOccurred())

	g.Expect(c.Get(context.TODO(), key, fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(fetched).To(gomega.Equal(created))

	g.Expect(created.Status.Resources[0].String()).To(gomega.Equal(constants.InteroperatorNamespace + "/dddd (Director v1alpha1)"))

	// Test Updating the Labels
	updatedObject := fetched.DeepCopyObject()
	updated := updatedObject.(*SFServiceInstance)
	updated.Labels = map[string]string{"hello": "world"}
	g.Expect(c.Update(context.TODO(), updated)).NotTo(gomega.HaveOccurred())

	g.Expect(c.Get(context.TODO(), key, fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(fetched).To(gomega.Equal(updated))

	// Test listing
	instanceList := &SFServiceInstanceList{}
	options := &kubernetes.ListOptions{
		Namespace: constants.InteroperatorNamespace,
	}
	labels := make(kubernetes.MatchingLabels)
	labels["hello"] = "world"
	labels.ApplyToList(options)
	g.Expect(c.List(context.TODO(), instanceList, options)).NotTo(gomega.HaveOccurred())
	g.Expect(len(instanceList.Items)).To(gomega.Equal(1))

	// Test deepcopy SFServiceInstanceList
	copiedListObject := instanceList.DeepCopyObject()
	copiedList := copiedListObject.(*SFServiceInstanceList)
	g.Expect(copiedList).To(gomega.Equal(instanceList))

	//Test deepcopy SFServiceInstanceSpec & SFServiceInstanceStatus
	copiedSpec := updated.Spec.DeepCopy()
	g.Expect(copiedSpec).To(gomega.Equal(&updated.Spec))
	copiedStatus := updated.Status.DeepCopy()
	g.Expect(copiedStatus).To(gomega.Equal(&updated.Status))

	//Test deepcopy Source
	copiedSource := updated.Status.Resources[0].DeepCopy()
	g.Expect(copiedSource).To(gomega.Equal(&updated.Status.Resources[0]))

	// Test Delete
	g.Expect(c.Delete(context.TODO(), fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Get(context.TODO(), key, fetched)).To(gomega.HaveOccurred())
}

func TestSFServiceInstance_GetState(t *testing.T) {
	type fields struct {
		TypeMeta   metav1.TypeMeta
		ObjectMeta metav1.ObjectMeta
		Spec       SFServiceInstanceSpec
		Status     SFServiceInstanceStatus
	}
	tests := []struct {
		name   string
		fields fields
		want   string
	}{
		{
			name: "return state",
			fields: fields{
				Status: SFServiceInstanceStatus{
					State: "succeeded",
				},
			},
			want: "succeeded",
		},
		{
			name:   "return empty string if state not set",
			fields: fields{},
			want:   "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &SFServiceInstance{
				TypeMeta:   tt.fields.TypeMeta,
				ObjectMeta: tt.fields.ObjectMeta,
				Spec:       tt.fields.Spec,
				Status:     tt.fields.Status,
			}
			if got := r.GetState(); got != tt.want {
				t.Errorf("SFServiceInstance.GetState() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSFServiceInstance_SetState(t *testing.T) {
	type fields struct {
		TypeMeta   metav1.TypeMeta
		ObjectMeta metav1.ObjectMeta
		Spec       SFServiceInstanceSpec
		Status     SFServiceInstanceStatus
	}
	type args struct {
		state string
	}
	tests := []struct {
		name   string
		fields fields
		args   args
		want   string
	}{
		{
			name: "set the state",
			fields: fields{
				Status: SFServiceInstanceStatus{
					State: "succeeded",
				},
			},
			args: args{
				state: "in progress",
			},
			want: "in progress",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &SFServiceInstance{
				TypeMeta:   tt.fields.TypeMeta,
				ObjectMeta: tt.fields.ObjectMeta,
				Spec:       tt.fields.Spec,
				Status:     tt.fields.Status,
			}
			r.SetState(tt.args.state)
			if got := r.GetState(); got != tt.want {
				t.Errorf("SFServiceInstance.GetState() = %v, want %v", got, tt.want)
			}
		})
	}
}
