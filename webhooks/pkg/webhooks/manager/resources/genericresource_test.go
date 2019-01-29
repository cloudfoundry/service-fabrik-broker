package resources

import (
	"reflect"
	"testing"
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
