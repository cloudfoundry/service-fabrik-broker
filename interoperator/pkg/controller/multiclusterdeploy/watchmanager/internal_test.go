package watchmanager

import (
	"reflect"
	"testing"

	"sigs.k8s.io/controller-runtime/pkg/event"
)

func Test_watchManager_getWatchChannel(t *testing.T) {
	type args struct {
		resource string
	}
	tests := []struct {
		name    string
		wm      *watchManager
		args    args
		want    <-chan event.GenericEvent
		wantErr bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.wm.getWatchChannel(tt.args.resource)
			if (err != nil) != tt.wantErr {
				t.Errorf("watchManager.getWatchChannel() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("watchManager.getWatchChannel() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_watchManager_addCluster(t *testing.T) {
	type args struct {
		clusterID string
	}
	tests := []struct {
		name    string
		wm      *watchManager
		args    args
		wantErr bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.wm.addCluster(tt.args.clusterID); (err != nil) != tt.wantErr {
				t.Errorf("watchManager.addCluster() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func Test_watchManager_removeCluster(t *testing.T) {
	type args struct {
		clusterID string
	}
	tests := []struct {
		name string
		wm   *watchManager
		args args
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.wm.removeCluster(tt.args.clusterID)
		})
	}
}
