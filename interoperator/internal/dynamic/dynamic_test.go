package dynamic

import (
	"reflect"
	"testing"
	"fmt"

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

func TestDeepUpdate(t *testing.T) {
	currentObj := make(map[string]interface{})
	currentArray := make([]map[string]interface{}, 1)
	currentMap := make(map[string]interface{})
	currentMap["foo"] = "bar"
	currentMap["abc"] = "def"
	currentArray[0] = currentMap
	currentObj["array"] = currentArray
	currentObj["array2"] = currentArray
	currentTags := make([]interface{}, 2)
	currentTags[0] = "foo"
	currentTags[1] = "bar"
	currentObj["tags"] = currentTags
	currentObj["tags2"] = currentTags
	currentObjString := ""

	newObj := make(map[string]interface{})
	newObj1 := make([]interface{}, 1)
	newArray := make([]map[string]interface{}, 1)
	newMap := make(map[string]interface{})
	newMap["foo"] = "bar2"
	newMap["foo2"] = "bar2"
	newArray[0] = newMap
	newArray2 := append(newArray[:0:0], newMap, newMap)
	newObj["array"] = newArray
	newObj["array2"] = newArray2
	newTags := make([]interface{}, 2)
	newTags[0] = "foo"
	newTags[1] = "baz"
	newTags2 := append(newTags[:0:0], newTags...)
	newTags2 = append(newTags2, "bar")
	newObj["tags"] = newTags
	newObj["tags2"] = newTags2

	updatedObj := make(map[string]interface{})
	updatedArray := make([]map[string]interface{}, 1)
	updatedMap := make(map[string]interface{})
	updatedMap["foo"] = "bar2"
	updatedMap["foo2"] = "bar2"
	updatedMap["abc"] = "def"
	updatedArray[0] = updatedMap
	updatedObj["array"] = updatedArray
	updatedArray2 := append(updatedArray[:0:0], updatedArray...)
	updatedObj["array2"] = append(updatedArray2, newMap)
	updatedObj["tags"] = newTags
	updatedObj["tags2"] = newTags2

	type args struct {
		currentObj interface{}
		newObj     interface{}
	}
	tests := []struct {
		name  string
		args  args
		want  interface{}
		want1 bool
		err   error
	}{
		{
			name: "Test1",
			args: args{
				currentObj: currentObj,
				newObj:     newObj,
			},
			want:  updatedObj,
			want1: true,
			err: nil,
		},
		{
            name: "Test2",
            args: args{
                currentObj: currentObjString,
                newObj:     newObj,
            },
            want:  currentObjString,
            want1: false,
            err: fmt.Errorf("failed to apply new value %s to the resources due to type mismatch. Type %T to %T", newObj, currentObjString, newObj),
        },
        {
            name: "Test3",
            args: args{
                currentObj: currentObjString,
                newObj:     newObj1,
            },
            want:  currentObjString,
            want1: false,
            err: fmt.Errorf("failed to apply new value %s to the resources due to type mismatch. Type %T to %T", newObj1, currentObjString, newObj1),
        },
        {
            name: "Test4",
            args: args{
                currentObj: currentObjString,
                newObj:     newArray,
            },
            want:  currentObjString,
            want1: false,
            err: fmt.Errorf("failed to apply new value %s to the resources due to type mismatch. Type %T to %T", newArray, currentObjString, newArray),
        },
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, got1, err := DeepUpdate(tt.args.currentObj, tt.args.newObj)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("DeepUpdate() got = %v, want %v", got, tt.want)
			}
			if got1 != tt.want1 {
				t.Errorf("DeepUpdate() got1 = %v, want %v", got1, tt.want1)
			}
			if err != nil && tt.err!= nil && err.Error() != tt.err.Error() {
			    t.Errorf("DeepUpdate() goterr %v, want %v", err, tt.err)
			}
		})
	}
}
