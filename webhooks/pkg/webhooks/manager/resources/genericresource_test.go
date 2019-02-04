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

func TestGenericResource_GetAppliedOptions(t *testing.T) {
	type fields struct {
		Kind       string
		ObjectMeta metav1.ObjectMeta
		Status     GenericStatus
		Spec       GenericSpec
	}
	tests := []struct {
		name    string
		fields  fields
		want    GenericOptions
		wantErr bool
	}{
		{
			"Should throw error for invalid json",
			fields{
				Status: GenericStatus{
					AppliedOptions: `{invalid}`,
				},
			},
			GenericOptions{},
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
			got, err := crd.GetAppliedOptions()
			if (err != nil) != tt.wantErr {
				t.Errorf("GenericResource.GetAppliedOptions() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("GenericResource.GetAppliedOptions() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGenericResource_SetLastOperation(t *testing.T) {
	type fields struct {
		Kind       string
		ObjectMeta metav1.ObjectMeta
		Status     GenericStatus
		Spec       GenericSpec
	}
	type args struct {
		lo GenericLastOperation
	}
	var emptyString string
	tests := []struct {
		name    string
		fields  fields
		args    args
		wantErr bool
	}{
		{
			"Should throw error if json parsing fails",
			fields{
				Status: GenericStatus{
					LastOperationRaw: `{invalid}`,
				},
			},
			args{
				GenericLastOperation{
					Type: emptyString,
				},
			},
			false,
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
			if err := crd.SetLastOperation(tt.args.lo); (err != nil) != tt.wantErr {
				t.Errorf("GenericResource.SetLastOperation() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
