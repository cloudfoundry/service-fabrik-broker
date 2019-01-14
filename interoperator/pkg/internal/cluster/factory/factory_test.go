package factory

import (
	"reflect"
	"testing"

	"sigs.k8s.io/controller-runtime/pkg/manager"
)

func TestNew(t *testing.T) {
	type args struct {
		mgr manager.Manager
	}
	tests := []struct {
		name    string
		args    args
		want    *ClusterFactory
		wantErr bool
	}{
		{
			name: "error on invalid arguments",
			args: args{
				mgr: nil,
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "error on invalid arguments",
			args: args{
				mgr: mgr,
			},
			want: &ClusterFactory{
				mgr: mgr,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := New(tt.args.mgr)
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

func TestClusterFactory_GetCluster(t *testing.T) {
	factory := &ClusterFactory{
		mgr: mgr,
		cfg: cfg,
	}
	type args struct {
		instanceID string
		bindingID  string
		serviceID  string
		planID     string
	}
	tests := []struct {
		name    string
		f       *ClusterFactory
		args    args
		want    bool
		wantErr bool
	}{
		{
			name: "error on no config",
			f: &ClusterFactory{
				mgr: mgr,
			},
			args: args{
				instanceID: "instanceId",
				bindingID:  "bindingID",
				serviceID:  "serviceID",
				planID:     "planID",
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "return new client",
			f:    factory,
			args: args{
				instanceID: "instanceId",
				bindingID:  "bindingID",
				serviceID:  "serviceID",
				planID:     "planID",
			},
			want:    true,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.f.GetCluster(tt.args.instanceID, tt.args.bindingID, tt.args.serviceID, tt.args.planID)
			if (err != nil) != tt.wantErr {
				t.Errorf("ClusterFactory.GetCluster() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if (got != nil) != tt.want {
				t.Errorf("ClusterFactory.GetCluster() = %v, want %v", got, tt.want)
			}
		})
	}
}
