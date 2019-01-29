package resources

import (
	"reflect"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestGenericSpec_GetOptions(t *testing.T) {
	type fields struct {
		Options string
	}
	tests := []struct {
		name    string
		fields  fields
		want    GenericOptions
		wantErr bool
	}{
		{
			"Should convert json string to GenericOptions object",
			fields{Options: `{"plan_id": "dummy_plan_id"}`},
			GenericOptions{PlanID: "dummy_plan_id"},
			false,
		}, {
			"Should throw error on invalid json string ",
			fields{Options: `{ invalid string }`},
			GenericOptions{},
			true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g := &GenericSpec{
				Options: tt.fields.Options,
			}
			got, err := g.GetOptions()
			if (err != nil) != tt.wantErr {
				t.Errorf("GenericSpec.GetOptions() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("GenericSpec.GetOptions() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGenericResource_GetLastOperation(t *testing.T) {
	type fields struct {
		Kind       string
		ObjectMeta metav1.ObjectMeta
		Status     GenericStatus
		Spec       GenericSpec
	}
	tests := []struct {
		name    string
		fields  fields
		want    GenericLastOperation
		wantErr bool
	}{
		{
			"Should throw error for invalid json",
			fields{
				Status: GenericStatus{
					LastOperationRaw: `{invalid}`,
				},
			},
			GenericLastOperation{},
			true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			crd := &GenericResource{
				Kind:       tt.fields.Kind,
				ObjectMeta: tt.fields.ObjectMeta,
				Status:     tt.fields.Status,
				Spec:       tt.fields.Spec,
			}
			got, err := crd.GetLastOperation()
			if (err != nil) != tt.wantErr {
				t.Errorf("GenericResource.GetLastOperation() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("GenericResource.GetLastOperation() = %v, want %v", got, tt.want)
			}
		})
	}
}
