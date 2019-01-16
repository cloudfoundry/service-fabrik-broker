package dynamic

import (
	"reflect"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestStringToUnstructured(t *testing.T) {
	type args struct {
		contentString string
	}

	output := &unstructured.Unstructured{}
	output.SetKind("Postgres")
	output.SetAPIVersion("kubedb.com/v1alpha1")

	tests := []struct {
		name    string
		args    args
		want    []*unstructured.Unstructured
		wantErr bool
	}{
		{
			name: "test1",
			args: args{
				contentString: `apiVersion: kubedb.com/v1alpha1
kind: Postgres`,
			},
			want:    []*unstructured.Unstructured{output},
			wantErr: false,
		},
		{
			name: "test2",
			args: args{
				contentString: `apiVersion`,
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "test3",
			args: args{
				contentString: `\\\\{"foo": 123, "bar": -123, "baz": "123"}`,
			},
			want:    nil,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := StringToUnstructured(tt.args.contentString)
			if (err != nil) != tt.wantErr {
				t.Errorf("StringToUnstructured() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("StringToUnstructured() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestMapInterfaceToMapString(t *testing.T) {
	type args struct {
		v interface{}
	}
	tests := []struct {
		name string
		args args
		want interface{}
	}{
		{
			name: "test1",
			args: args{
				v: map[interface{}]interface{}{
					"Name": "Wednesday",
					"Age":  6,
				},
			},
			want: map[string]interface{}{
				"Name": "Wednesday",
				"Age":  6,
			},
		},
		{
			name: "test2",
			args: args{
				v: map[interface{}]interface{}{
					6: 7,
					7: 8,
				},
			},
			want: map[string]interface{}{
				"6": 7,
				"7": 8,
			},
		},
		{
			name: "test3",
			args: args{
				v: []interface{}{
					map[interface{}]interface{}{
						"Name": "Wednesday",
						"Age":  6,
					},
				},
			},
			want: []interface{}{map[string]interface{}{
				"Name": "Wednesday",
				"Age":  6,
			}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := MapInterfaceToMapString(tt.args.v); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("MapInterfaceToMapString() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestObjectToMapInterface(t *testing.T) {
	type args struct {
		obj interface{}
	}

	type input struct {
		Name    string
		Address string
	}
	inputObj := input{
		Name:    "Wednesday",
		Address: "Bangalore",
	}
	tests := []struct {
		name    string
		args    args
		want    map[string]interface{}
		wantErr bool
	}{
		{
			name: "test1",
			args: args{
				obj: inputObj,
			},
			want: map[string]interface{}{
				"Name":    "Wednesday",
				"Address": "Bangalore",
			},
			wantErr: false,
		},
		{
			name: "test2",
			args: args{
				obj: "Name",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "test3",
			args: args{
				obj: make(chan int),
			},
			want:    nil,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ObjectToMapInterface(tt.args.obj)
			if (err != nil) != tt.wantErr {
				t.Errorf("ObjectToMapInterface() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ObjectToMapInterface() = %v, want %v", got, tt.want)
			}
		})
	}
}
