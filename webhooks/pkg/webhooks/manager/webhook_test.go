package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"net/http"
	"reflect"
	"testing"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/resources"
	"k8s.io/api/admission/v1beta1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

type MockEvent struct {
	AdmissionReview      *v1beta1.AdmissionReview
	crd                  resources.GenericResource
	oldCrd               resources.GenericResource
	isMetering           bool
	isMeteringError      error
	createMerteringError error
}

func (e *MockEvent) isMeteringEvent() (bool, error) {
	return e.isMetering, e.isMeteringError
}

func (e *MockEvent) createMertering(cfg *rest.Config) error {
	return e.createMerteringError
}

type MockAPIServer struct {
	err error
}

func (a *MockAPIServer) GetConfig() (*rest.Config, error) {
	return &rest.Config{}, a.err
}

func TestWebhookServer_meter(t *testing.T) {
	type fields struct {
		server *http.Server
	}
	type args struct {
		evt EventInterface
		a   APIServerInterface
	}
	tests := []struct {
		name   string
		fields fields
		args   args
		want   *v1beta1.AdmissionResponse
	}{
		{
			"Admit if not a metering event",
			fields{},
			args{
				evt: &MockEvent{
					isMetering:           false,
					createMerteringError: nil,
				},
				a: &MockAPIServer{
					err: nil,
				},
			},
			&v1beta1.AdmissionResponse{
				UID:       "",
				Allowed:   true,
				Result:    nil,
				Patch:     nil,
				PatchType: nil,
			},
		}, {
			"Admit if a metering event is successfully created",
			fields{},
			args{
				evt: &MockEvent{
					isMetering:           true,
					createMerteringError: nil,
				},
				a: &MockAPIServer{
					err: nil,
				},
			},
			&v1beta1.AdmissionResponse{
				UID:       "",
				Allowed:   true,
				Result:    nil,
				Patch:     nil,
				PatchType: nil,
			},
		}, {
			"Do not admit Admit if a metering event is not created",
			fields{},
			args{
				evt: &MockEvent{
					isMetering:           true,
					createMerteringError: errors.New("Dummy failure"),
				},
				a: &MockAPIServer{
					err: nil,
				},
			},
			&v1beta1.AdmissionResponse{
				UID:     "",
				Allowed: false,
				Result: &metav1.Status{
					ListMeta: metav1.ListMeta{
						SelfLink:        "",
						ResourceVersion: "",
						Continue:        "",
					}, Status: "",
					Message: "Dummy failure",
					Reason:  "",
					Details: nil,
					Code:    0},
				Patch:     nil,
				PatchType: nil,
			},
		}, {
			"Do not admit Admit if a isMeteringError fails",
			fields{},
			args{
				evt: &MockEvent{
					isMetering:      false,
					isMeteringError: errors.New("Dummy isMeteringError failure"),
				}, a: &MockAPIServer{
					err: nil,
				},
			},
			&v1beta1.AdmissionResponse{
				UID:     "",
				Allowed: false,
				Result: &metav1.Status{
					ListMeta: metav1.ListMeta{
						SelfLink:        "",
						ResourceVersion: "",
						Continue:        "",
					}, Status: "",
					Message: "Dummy isMeteringError failure",
					Reason:  "",
					Details: nil,
					Code:    0},
				Patch:     nil,
				PatchType: nil,
			},
		}, {
			"Do not admit Admit if a fetching config fails",
			fields{},
			args{
				evt: &MockEvent{
					isMetering:      true,
					isMeteringError: nil,
				}, a: &MockAPIServer{
					err: errors.New("Fetching config failed"),
				},
			},
			&v1beta1.AdmissionResponse{
				UID:     "",
				Allowed: false,
				Result: &metav1.Status{
					ListMeta: metav1.ListMeta{
						SelfLink:        "",
						ResourceVersion: "",
						Continue:        "",
					}, Status: "",
					Message: "Fetching config failed",
					Reason:  "",
					Details: nil,
					Code:    0},
				Patch:     nil,
				PatchType: nil,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			whsvr := &WebhookServer{
				server: tt.fields.server,
			}
			if got := whsvr.meter(tt.args.evt, tt.args.a); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("WebhookServer.meter() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_createPatch(t *testing.T) {
	type args struct {
		resource *resources.GenericResource
	}
	tests := []struct {
		name string
		args args
		want []byte
	}{
		{
			"Should create a patch with correct labels",
			args{
				resource: &resources.GenericResource{
					Status: resources.GenericStatus{
						State: "dummy state",
					},
				},
			},
			[]byte(fmt.Sprintf(newLabelPatchTemplate, "dummy state")),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := createPatch(tt.args.resource); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("createPatch() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestWebhookServer_mutate(t *testing.T) {
	var ar v1beta1.AdmissionReview
	var arInvalid v1beta1.AdmissionReview
	dat, err := ioutil.ReadFile("test_resources/admission_request.json")
	err = json.Unmarshal(dat, &ar)
	if err != nil {
		panic(err)
	}

	// Populate arInvalid with dummy data
	err = json.Unmarshal(dat, &arInvalid)
	if err != nil {
		panic(err)
	}
	arInvalid.Request.Object.Raw = []byte("invalid")

	type fields struct {
		server *http.Server
	}
	type args struct {
		ar *v1beta1.AdmissionReview
	}
	tests := []struct {
		name   string
		fields fields
		args   args
		want   *v1beta1.AdmissionResponse
	}{
		{
			"Mutate if no label present",
			fields{},
			args{
				ar: &ar,
			},
			&v1beta1.AdmissionResponse{
				UID:     "",
				Allowed: true,
				Result:  nil,
				Patch:   []byte(fmt.Sprintf(labelPatchTemplate, "succeeded")),
				PatchType: func() *v1beta1.PatchType {
					pt := v1beta1.PatchTypeJSONPatch
					return &pt
				}(),
			},
		}, {
			"Throw error if objct is invalid",
			fields{},
			args{
				ar: &arInvalid,
			},
			&v1beta1.AdmissionResponse{
				UID:     "",
				Allowed: false,
				Result: &metav1.Status{
					ListMeta: metav1.ListMeta{
						SelfLink:        "",
						ResourceVersion: "",
						Continue:        "",
					}, Status: "",
					Message: "invalid character 'i' looking for beginning of value",
					Reason:  "",
					Details: nil,
					Code:    0},
				Patch:     nil,
				PatchType: nil,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			whsvr := &WebhookServer{
				server: tt.fields.server,
			}
			if got := whsvr.mutate(tt.args.ar); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("WebhookServer.mutate() = %v, want %v", got, tt.want)
			}
		})
	}
}
