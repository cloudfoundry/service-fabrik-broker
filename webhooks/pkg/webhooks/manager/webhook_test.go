package main

import (
	"errors"
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

func TestWebhookServer_meter(t *testing.T) {
	type fields struct {
		server *http.Server
	}
	type args struct {
		evt EventInterface
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
		},
		{
			"Do not admit Admit if a isMeteringError fails",
			fields{},
			args{
				evt: &MockEvent{
					isMetering:      false,
					isMeteringError: errors.New("Dummy isMeteringError failure"),
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
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			whsvr := &WebhookServer{
				server: tt.fields.server,
			}
			if got := whsvr.meter(tt.args.evt); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("WebhookServer.meter() = %v, want %v", got, tt.want)
			}
		})
	}
}
