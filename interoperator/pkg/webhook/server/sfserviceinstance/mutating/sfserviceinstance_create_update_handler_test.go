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

package mutating

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/appscode/jsonpatch"
	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	yaml "gopkg.in/yaml.v2"
	admissionv1beta1 "k8s.io/api/admission/v1beta1"
	authenticationv1 "k8s.io/api/authentication/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/webhook/admission"
	"sigs.k8s.io/controller-runtime/pkg/webhook/admission/types"
)

func TestSFServiceInstanceCreateUpdateHandler_mutatingSFServiceInstanceFn(t *testing.T) {
	type fields struct {
		Decoder types.Decoder
	}
	type args struct {
		obj *osbv1alpha1.SFServiceInstance
	}
	params := `{
		"foo": "bar",
		"fizz": "buzz"
	}`
	re := &runtime.RawExtension{}
	_ = re.UnmarshalJSON([]byte(params))
	spec := osbv1alpha1.SFServiceInstanceSpec{
		ServiceID:        "service-id",
		PlanID:           "plan-id",
		RawContext:       re,
		OrganizationGUID: "org-id",
		SpaceGUID:        "space-id",
		RawParameters:    re,
		PreviousValues:   re,
	}
	instance := &osbv1alpha1.SFServiceInstance{
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
		},
	}
	decoder, err := admission.NewDecoder(runtime.NewScheme())
	if err != nil {
		t.Error(err)
	}
	tests := []struct {
		name    string
		fields  fields
		args    args
		wantErr bool
	}{
		{
			"Test to validate SFServiceInstance label modification",
			fields{decoder},
			args{instance},
			false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &SFServiceInstanceCreateUpdateHandler{
				Decoder: tt.fields.Decoder,
			}
			if err := h.mutatingSFServiceInstanceFn(tt.args.obj); (err != nil) != tt.wantErr {
				t.Errorf("SFServiceInstanceCreateUpdateHandler.mutatingSFServiceInstanceFn() error = %v, wantErr %v", err, tt.wantErr)
			}
			// Validate labels in the modified SFServiceInstance.
			labels := make(map[string]interface{})
			if err := yaml.Unmarshal(re.Raw, &labels); err != nil {
				t.Error(err)
			}
			for k, v := range labels {
				switch v.(type) {
				case string:
					if val, ok := tt.args.obj.Labels[k]; ok && v != val {
						t.Errorf("Label %s not found in SFServiceInstance", v)
					}
				}
			}
		})
	}
}

func TestSFServiceInstanceCreateUpdateHandler_Handle(t *testing.T) {
	type fields struct {
		Decoder types.Decoder
	}
	type args struct {
		ctx context.Context
		req types.Request
	}
	decoder, err := admission.NewDecoder(runtime.NewScheme())
	if err != nil {
		t.Error(err)
	}
	params := `{
		"foo": "bar",
		"baz": {
			"fizz": "buzz"
		}
	}`
	re := &runtime.RawExtension{}
	_ = re.UnmarshalJSON([]byte(params))
	spec := osbv1alpha1.SFServiceInstanceSpec{
		ServiceID:        "service-id",
		PlanID:           "plan-id",
		RawContext:       re,
		OrganizationGUID: "org-id",
		SpaceGUID:        "space-id",
		RawParameters:    re,
		PreviousValues:   re,
	}
	instance := &osbv1alpha1.SFServiceInstance{
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
		},
	}
	req := types.Request{
		AdmissionRequest: &admissionv1beta1.AdmissionRequest{
			UID:         "",
			Kind:        metav1.GroupVersionKind{},
			Resource:    metav1.GroupVersionResource{},
			SubResource: "",
			Name:        "",
			Namespace:   "",
			Operation:   "",
			UserInfo:    authenticationv1.UserInfo{},
			Object: runtime.RawExtension{
				Raw: func() []byte {
					buf := new(bytes.Buffer)
					json.NewEncoder(buf).Encode(instance)
					return buf.Bytes()
				}(),
				Object: instance,
			},
			OldObject: runtime.RawExtension{},
			DryRun: func() *bool {
				dr := false
				return &dr
			}(),
		}}
	resp := types.Response{
		Patches: []jsonpatch.JsonPatchOperation{{
			Operation: "add",
			Path:      "/metadata/labels",
			// Since the value corresponding to "baz" in `spec.Context` is not
			// a string, it will not be added as a label and hence will be
			// absent in the resulting admission response.
			Value: map[string]interface{}{"foo": "bar"},
		}},
		Response: &admissionv1beta1.AdmissionResponse{
			UID:     "",
			Allowed: true,
			Result:  nil,
			Patch:   nil,
			PatchType: func() *admissionv1beta1.PatchType {
				pt := admissionv1beta1.PatchTypeJSONPatch
				return &pt
			}(),
			AuditAnnotations: nil,
		},
	}
	tests := []struct {
		name   string
		fields fields
		args   args
		want   types.Response
	}{
		{
			"Test to validate admission request handling",
			fields{decoder},
			args{context.TODO(), req},
			resp,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &SFServiceInstanceCreateUpdateHandler{
				Decoder: tt.fields.Decoder,
			}
			if got := h.Handle(tt.args.ctx, tt.args.req); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("SFServiceInstanceCreateUpdateHandler.Handle() = %v, want %v", got, tt.want)
			}
		})
	}
}
