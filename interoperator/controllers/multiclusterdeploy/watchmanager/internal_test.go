package watchmanager

import (
	"fmt"
	"reflect"
	"testing"

	mock_v1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1/mock_sfcluster"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"

	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"

	gomock "github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

func Test_watchManager_getWatchChannel(t *testing.T) {
	instanceEvents := make(chan event.GenericEvent, 1024)
	bindingEvents := make(chan event.GenericEvent, 1024)
	clusterEvents := make(chan event.GenericEvent, 1024)

	type fields struct {
		instanceEvents chan event.GenericEvent
		bindingEvents  chan event.GenericEvent
		clusterEvents  chan event.GenericEvent
	}
	type args struct {
		resource string
	}
	tests := []struct {
		name    string
		fields  fields
		args    args
		want    <-chan event.GenericEvent
		wantErr bool
	}{
		{
			name:   "should fail on invalid resource",
			fields: fields{},
			args: args{
				resource: "foo",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name:   "should fail if instanceEvents is nil",
			fields: fields{},
			args: args{
				resource: "sfserviceinstances",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name:   "should fail if bindingEvents is nil",
			fields: fields{},
			args: args{
				resource: "sfservicebindings",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name:   "should fail if clusterEvents is nil",
			fields: fields{},
			args: args{
				resource: "sfclusters",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "should return instanceEvents",
			fields: fields{
				instanceEvents: instanceEvents,
			},
			args: args{
				resource: "sfserviceinstances",
			},
			want: instanceEvents,

			wantErr: false,
		},
		{
			name: "should return bindingEvents",
			fields: fields{
				bindingEvents: bindingEvents,
			},
			args: args{
				resource: "sfservicebindings",
			},
			want:    bindingEvents,
			wantErr: false,
		},
		{
			name: "should return clusterEvents",
			fields: fields{
				clusterEvents: clusterEvents,
			},
			args: args{
				resource: "sfclusters",
			},
			want:    clusterEvents,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wm := &watchManager{
				instanceEvents: tt.fields.instanceEvents,
				bindingEvents:  tt.fields.bindingEvents,
				clusterEvents:  tt.fields.clusterEvents,
			}
			got, err := wm.getWatchChannel(tt.args.resource)
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
	g := gomega.NewGomegaWithT(t)
	var ctrl *gomock.Controller

	setupClients(g)
	setupCfgManager(g)

	type fields struct {
		defaultCluster  kubernetes.Client
		clusterRegistry registry.ClusterRegistry
		clusterWatchers []*clusterWatcher
		cfgManager      config.Config
	}
	type args struct {
		clusterID string
	}
	tests := []struct {
		name    string
		fields  fields
		args    args
		wantErr bool
		setup   func(*watchManager)
		cleanup func(*watchManager)
	}{
		{
			name: "should do nothing if cluster already being watched",
			fields: fields{
				clusterWatchers: []*clusterWatcher{
					&clusterWatcher{
						clusterID: "foo",
					},
				},
			},
			args: args{
				clusterID: "foo",
			},
			wantErr: false,
			setup: func(wm *watchManager) {
			},
			cleanup: func(wm *watchManager) {
			},
		},
		{
			name: "should fail if GetCluster fails",
			fields: fields{
				clusterWatchers: []*clusterWatcher{},
			},
			args: args{
				clusterID: "bar",
			},
			wantErr: true,
			setup: func(wm *watchManager) {
				ctrl = gomock.NewController(t)
				mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)
				mockClusterRegistry.EXPECT().GetCluster("bar").Return(nil, fmt.Errorf("bar")).Times(1)
				wm.clusterRegistry = mockClusterRegistry
			},
			cleanup: func(wm *watchManager) {
				defer ctrl.Finish()
			},
		},
		{
			name: "should fail if GetKubeConfig fails",
			fields: fields{
				defaultCluster:  c1,
				clusterWatchers: []*clusterWatcher{},
				cfgManager:      cfgManager,
			},
			args: args{
				clusterID: "bar",
			},
			wantErr: true,
			setup: func(wm *watchManager) {
				ctrl = gomock.NewController(t)
				mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)
				mockCluster := mock_v1alpha1.NewMockSFClusterInterface(ctrl)
				mockCluster.EXPECT().GetKubeConfig(c1).Return(nil, fmt.Errorf("bar"))
				mockClusterRegistry.EXPECT().GetCluster("bar").Return(mockCluster, nil).Times(1)
				wm.clusterRegistry = mockClusterRegistry
			},
			cleanup: func(wm *watchManager) {
				defer ctrl.Finish()
			},
		},
		{
			name: "should add cluster",
			fields: fields{
				defaultCluster:  c1,
				clusterWatchers: []*clusterWatcher{},
				cfgManager:      cfgManager,
			},
			args: args{
				clusterID: "bar",
			},
			wantErr: false,
			setup: func(wm *watchManager) {
				ctrl = gomock.NewController(t)
				mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)
				mockCluster := mock_v1alpha1.NewMockSFClusterInterface(ctrl)
				mockCluster.EXPECT().GetKubeConfig(c1).Return(cfg2, nil)
				mockClusterRegistry.EXPECT().GetCluster("bar").Return(mockCluster, nil).Times(1)
				wm.clusterRegistry = mockClusterRegistry
			},
			cleanup: func(wm *watchManager) {
				//wm.removeCluster("bar")
				defer ctrl.Finish()
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wm := &watchManager{
				defaultCluster:  tt.fields.defaultCluster,
				clusterRegistry: tt.fields.clusterRegistry,
				clusterWatchers: tt.fields.clusterWatchers,
				cfgManager:      tt.fields.cfgManager,
			}
			if tt.setup != nil {
				tt.setup(wm)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(wm)
			}
			if err := wm.addCluster(tt.args.clusterID); (err != nil) != tt.wantErr {
				t.Errorf("watchManager.addCluster() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func Test_watchManager_removeCluster(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	//var ctrl *gomock.Controller

	setupClients(g)

	cluster := &clusterWatcher{
		clusterID: "foo",
		stop:      make(chan struct{}),
	}
	type fields struct {
		defaultCluster  kubernetes.Client
		clusterRegistry registry.ClusterRegistry
		clusterWatchers []*clusterWatcher
	}
	type args struct {
		clusterID string
	}
	tests := []struct {
		name    string
		fields  fields
		args    args
		setup   func(*watchManager)
		cleanup func(*watchManager)
	}{
		{
			name: "should do nothing if cluster is not being watched",
			fields: fields{
				clusterWatchers: []*clusterWatcher{
					cluster,
				},
			},
			args: args{
				clusterID: "bar",
			},
			setup: func(wm *watchManager) {
			},
			cleanup: func(wm *watchManager) {
				g.Expect(len(wm.clusterWatchers)).To(gomega.Equal(1))
			},
		},
		{
			name: "should do stop and delete clusterwatcher",
			fields: fields{
				clusterWatchers: []*clusterWatcher{
					cluster,
				},
			},
			args: args{
				clusterID: "foo",
			},
			setup: func(wm *watchManager) {
			},
			cleanup: func(wm *watchManager) {
				g.Expect(cluster.stop).To(gomega.BeClosed())
				g.Expect(len(wm.clusterWatchers)).To(gomega.BeZero())
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wm := &watchManager{
				defaultCluster:  tt.fields.defaultCluster,
				clusterRegistry: tt.fields.clusterRegistry,
				clusterWatchers: tt.fields.clusterWatchers,
			}
			if tt.setup != nil {
				tt.setup(wm)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(wm)
			}
			wm.removeCluster(tt.args.clusterID)
		})
	}
}

func Test_watchManager_isWatchingOnCluster(t *testing.T) {
	type fields struct {
		clusterWatchers []*clusterWatcher
	}
	type args struct {
		clusterID string
	}
	tests := []struct {
		name   string
		fields fields
		args   args
		want   bool
	}{
		{
			name: "should return false if clusterID not found",
			fields: fields{
				clusterWatchers: []*clusterWatcher{
					&clusterWatcher{
						clusterID: "foo",
					},
				},
			},
			args: args{
				clusterID: "bar",
			},
			want: false,
		},
		{
			name: "should return true if clusterID is found",
			fields: fields{
				clusterWatchers: []*clusterWatcher{
					&clusterWatcher{
						clusterID: "foo",
					},
					&clusterWatcher{
						clusterID: "bar",
					},
				},
			},
			args: args{
				clusterID: "bar",
			},
			want: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wm := &watchManager{
				clusterWatchers: tt.fields.clusterWatchers,
			}
			if got := wm.isWatchingOnCluster(tt.args.clusterID); got != tt.want {
				t.Errorf("watchManager.isWatchingOnCluster() = %v, want %v", got, tt.want)
			}
		})
	}
}
