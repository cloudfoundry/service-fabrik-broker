// +build multiclusterdeploy

package watchmanager

import (
	"reflect"
	"testing"

	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

func TestGetWatchChannel(t *testing.T) {
	type args struct {
		resource string
	}
	tests := []struct {
		name    string
		args    args
		want    <-chan event.GenericEvent
		wantErr bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := GetWatchChannel(tt.args.resource)
			if (err != nil) != tt.wantErr {
				t.Errorf("GetWatchChannel() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("GetWatchChannel() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestInitialize(t *testing.T) {
	type args struct {
		kubeConfig *rest.Config
		scheme     *runtime.Scheme
		mapper     meta.RESTMapper
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := Initialize(tt.args.kubeConfig, tt.args.scheme, tt.args.mapper); (err != nil) != tt.wantErr {
				t.Errorf("Initialize() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestAddCluster(t *testing.T) {
	type args struct {
		clusterID string
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := AddCluster(tt.args.clusterID); (err != nil) != tt.wantErr {
				t.Errorf("AddCluster() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestRemoveCluster(t *testing.T) {
	type args struct {
		clusterID string
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := RemoveCluster(tt.args.clusterID); (err != nil) != tt.wantErr {
				t.Errorf("RemoveCluster() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
