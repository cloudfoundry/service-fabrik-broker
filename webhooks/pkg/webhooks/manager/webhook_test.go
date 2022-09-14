package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"testing"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/resources"
	"k8s.io/api/admission/v1beta1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

type MockEvent struct {
	AdmissionReview      *v1beta1.AdmissionReview
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
			[]byte(fmt.Sprintf(newLabelPatchTemplate, "dummy_state")),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := createPatch(tt.args.resource); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("createPatch() = %v, want %v", string(got), string(tt.want))
			}
		})
	}
}

func TestWebhookServer_mutate(t *testing.T) {
	var ar v1beta1.AdmissionReview
	var arInvalid v1beta1.AdmissionReview
	dat, err := os.ReadFile("test_resources/admission_request.json")
	if err != nil {
		panic(err)
	}
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

func TestWebhookServer_serve(t *testing.T) {
	dat, err := os.ReadFile("test_resources/admission_request.json")
	if err != nil {
		panic(err)
	}
	type fields struct {
		server *http.Server
	}
	type args struct {
		w *httptest.ResponseRecorder
		r *http.Request
	}
	testReq := httptest.NewRequest("GET", "/meter", bytes.NewReader(dat))
	testReq.Header.Set("Content-Type", "application/json")

	testInvalidReq := httptest.NewRequest("GET", "/meter", bytes.NewReader([]byte("invalid")))
	testInvalidReq.Header.Set("Content-Type", "application/json")
	tests := []struct {
		name           string
		fields         fields
		args           args
		wantStatusCode int
		wantBody       string
	}{
		{
			"Return 400 if request body is empty",
			fields{},
			args{
				w: httptest.NewRecorder(),
				r: httptest.NewRequest("GET", "/meter", nil),
			},
			400,
			"empty body\n",
		}, {
			"Should return error if content type is not set",
			fields{},
			args{
				w: httptest.NewRecorder(),
				r: httptest.NewRequest("GET", "/meter", bytes.NewReader(dat)),
			},
			415,
			"invalid Content-Type, expect `application/json`\n",
		}, {
			"Should create mutation for a valid request",
			fields{},
			args{
				w: httptest.NewRecorder(),
				r: testReq,
			},
			200,
			"{\"response\":{\"uid\":\"8f676fb0-13ce-11e9-b037-0e655bfa3b31\",\"allowed\":true}}",
		}, {
			"Should thow an error for invalid body",
			fields{},
			args{
				w: httptest.NewRecorder(),
				r: testInvalidReq,
			},
			200,
			`{"response":{"uid":"","allowed":false,"status":{"metadata":{},"message":"couldn't get version/kind; json parse error: json: cannot unmarshal string into Go value of type struct { APIVersion string \"json:\\\"apiVersion,omitempty\\\"\"; Kind string \"json:\\\"kind,omitempty\\\"\" }"}}}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			whsvr := &WebhookServer{
				server: tt.fields.server,
			}
			whsvr.serve(tt.args.w, tt.args.r)
			result := tt.args.w.Result()
			if got := result.StatusCode; !reflect.DeepEqual(got, tt.wantStatusCode) {
				t.Errorf("WebhookServer.server() = %v, want %v", result, tt)
			}
			if gotBody := tt.args.w.Body.String(); !reflect.DeepEqual(gotBody, tt.wantBody) {
				t.Errorf("Result Body recieved = %v, want %v", gotBody, tt.wantBody)
			}
		})
	}
}
