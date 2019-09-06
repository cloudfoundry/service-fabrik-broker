package provisioner

import (
	"reflect"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func TestNew(t *testing.T) {
	type args struct {
		kubeConfig *rest.Config
		scheme     *runtime.Scheme
		mapper     meta.RESTMapper
	}
	tests := []struct {
		name    string
		args    args
		want    Provisioner
		wantErr bool
	}{
	// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := New(tt.args.kubeConfig, tt.args.scheme, tt.args.mapper)
			if (err != nil) != tt.wantErr {
				t.Errorf("New() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("New() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_provisioner_FetchStatefulset(t *testing.T) {
	type fields struct {
		c           client.Client
		statefulSet *appsv1.StatefulSet
		namespace   string
	}
	tests := []struct {
		name    string
		fields  fields
		wantErr bool
	}{
	// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sfs := &provisioner{
				c:           tt.fields.c,
				statefulSet: tt.fields.statefulSet,
				namespace:   tt.fields.namespace,
			}
			if err := sfs.FetchStatefulset(); (err != nil) != tt.wantErr {
				t.Errorf("provisioner.FetchStatefulset() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func Test_provisioner_GetStatefulSet(t *testing.T) {
	type fields struct {
		c           client.Client
		statefulSet *appsv1.StatefulSet
		namespace   string
	}
	tests := []struct {
		name    string
		fields  fields
		want    *appsv1.StatefulSet
		wantErr bool
	}{
	// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sfs := &provisioner{
				c:           tt.fields.c,
				statefulSet: tt.fields.statefulSet,
				namespace:   tt.fields.namespace,
			}
			got, err := sfs.GetStatefulSet()
			if (err != nil) != tt.wantErr {
				t.Errorf("provisioner.GetStatefulSet() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("provisioner.GetStatefulSet() = %v, want %v", got, tt.want)
			}
		})
	}
}
