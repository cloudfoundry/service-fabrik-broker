package watchmanager

import (
	"context"
	"fmt"
	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"reflect"
	"sigs.k8s.io/controller-runtime/pkg/manager"
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

	setupClients(g)

	clusterOne := &clusterWatcher{
		clusterID: "one",
		stop:      make(chan struct{}),
	}
	clusterTwo := &clusterWatcher{
		clusterID: "two",
		stop:      make(chan struct{}),
	}

	type fields struct {
		defaultCluster  kubernetes.Client
		clusterRegistry registry.ClusterRegistry
		clusterWatchers []*clusterWatcher
		sfcrRequeue     []*clusterWatcher
	}
	type args struct {
		clusterID string
	}
	tests := []struct {
		name   string
		fields fields
		args   args
		setup  func(*watchManager)
		verify func(*watchManager)
	}{
		{
			name: "should do nothing if cluster is not being watched",
			fields: fields{
				clusterWatchers: []*clusterWatcher{
					clusterOne,
					clusterTwo,
				},
				sfcrRequeue: []*clusterWatcher{
					clusterOne,
					clusterTwo,
				},
			},
			args: args{
				clusterID: "bar",
			},
			setup: func(wm *watchManager) {
			},
			verify: func(wm *watchManager) {
				g.Expect(len(wm.clusterWatchers)).To(gomega.Equal(2))
				g.Expect(len(wm.sfcrRequeue)).To(gomega.Equal(2))

			},
		},
		{
			name: "should stop and delete clusterwatcher and sfcrRequeue ",
			fields: fields{
				clusterWatchers: []*clusterWatcher{
					clusterOne,
					clusterTwo,
				},
				sfcrRequeue: []*clusterWatcher{
					clusterOne,
				},
			},
			args: args{
				clusterID: "one",
			},
			setup: func(wm *watchManager) {
			},
			verify: func(wm *watchManager) {
				g.Expect(clusterOne.stop).To(gomega.BeClosed())
				g.Expect(len(wm.clusterWatchers)).To(gomega.Equal(1))
				g.Expect(len(wm.sfcrRequeue)).To(gomega.BeZero())
			},
		},
		{
			name: "should stop and delete clusterwatcher and do nothing for sfcrRequeue",
			fields: fields{
				clusterWatchers: []*clusterWatcher{
					clusterOne,
					clusterTwo,
				},
				sfcrRequeue: []*clusterWatcher{
					clusterOne,
				},
			},
			args: args{
				clusterID: "two",
			},
			setup: func(wm *watchManager) {
			},
			verify: func(wm *watchManager) {
				g.Expect(clusterTwo.stop).To(gomega.BeClosed())
				g.Expect(len(wm.clusterWatchers)).To(gomega.Equal(1))
				g.Expect(len(wm.sfcrRequeue)).To(gomega.Equal(1))
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wm := &watchManager{
				defaultCluster:  tt.fields.defaultCluster,
				clusterRegistry: tt.fields.clusterRegistry,
				clusterWatchers: tt.fields.clusterWatchers,
				sfcrRequeue:     tt.fields.sfcrRequeue,
			}
			if tt.setup != nil {
				tt.setup(wm)
			}
			if tt.verify != nil {
				defer tt.verify(wm)
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

func Test_watchManager_isWatchingOnSfcrRequeue(t *testing.T) {
	type fields struct {
		sfcrRequeue []*clusterWatcher
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
				sfcrRequeue: []*clusterWatcher{
					{
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
				sfcrRequeue: []*clusterWatcher{
					{
						clusterID: "foo",
					},
					{
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
				sfcrRequeue: tt.fields.sfcrRequeue,
			}
			if got := wm.isWatchingOnSfcrRequeue(tt.args.clusterID); got != tt.want {
				t.Errorf("watchManager.isWatchingOnSfcrRequeue() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_watchManager_getClusterWatch(t *testing.T) {
	clusterOne := &clusterWatcher{
		clusterID: "clusterOne",
		stop:      make(chan struct{}),
	}
	clusterTwo := &clusterWatcher{
		clusterID: "clusterTwo",
		stop:      make(chan struct{}),
	}
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
		want   *clusterWatcher
	}{
		{
			name: "should return false if clusterID not found",
			fields: fields{
				clusterWatchers: []*clusterWatcher{
					clusterOne,
					clusterTwo,
				},
			},
			args: args{
				clusterID: "one",
			},
			want: nil,
		},
		{
			name: "should return true if clusterID is found",
			fields: fields{
				clusterWatchers: []*clusterWatcher{
					clusterOne,
					clusterTwo,
				},
			},
			args: args{
				clusterID: "clusterTwo",
			},
			want: clusterTwo,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			wm := &watchManager{
				clusterWatchers: tt.fields.clusterWatchers,
			}
			if got := wm.getClusterWatch(tt.args.clusterID); got != tt.want {
				t.Errorf("watchManager.isWatchingOnSfcrRequeue() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_watchManager_requeueSFCRs(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	//var ctrl *gomock.Controller

	mgr, err := manager.New(cfg1, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	_ = mgr.GetFieldIndexer().IndexField(context.Background(), &osbv1alpha1.SFServiceInstance{}, "spec.clusterId", func(o runtime.Object) []string {
		clusterID := o.(*osbv1alpha1.SFServiceInstance).Spec.ClusterID
		return []string{clusterID}
	})

	_ = mgr.GetFieldIndexer().IndexField(context.Background(), &osbv1alpha1.SFServiceInstance{}, "status.state", func(o runtime.Object) []string {
		instance_state := o.(*osbv1alpha1.SFServiceInstance).Status.State
		return []string{instance_state}
	})

	_ = mgr.GetFieldIndexer().IndexField(context.Background(), &osbv1alpha1.SFServiceBinding{}, "status.state", func(o runtime.Object) []string {
		binding_state := o.(*osbv1alpha1.SFServiceBinding).Status.State
		return []string{binding_state}
	})

	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	clusterOne := &clusterWatcher{
		clusterID:      "clusterOne",
		stop:           make(chan struct{}),
		instanceEvents: make(chan event.GenericEvent, 1024),
		bindingEvents:  make(chan event.GenericEvent, 1024),
	}
	type fields struct {
		clusterWatchers []*clusterWatcher
		sfcrRequeue     []*clusterWatcher
	}

	client := mgr.GetClient()

	type args struct {
		clusterID    string
		cachedClient kubernetes.Client
	}
	tests := []struct {
		name    string
		fields  fields
		args    args
		setup   func()
		verify  func(*watchManager)
		wantErr bool
	}{
		{
			name: "should return nil if clusterRequeue already contains given Cluster",
			fields: fields{
				sfcrRequeue: []*clusterWatcher{
					clusterOne,
				},
			},
			args: args{
				clusterID:    "clusterOne",
				cachedClient: mgr.GetClient(),
			},
			wantErr: false,
		},
		{
			name: "should return error when watch manager is not watching on given Cluster",
			fields: fields{
				sfcrRequeue:     []*clusterWatcher{},
				clusterWatchers: []*clusterWatcher{},
			},
			args: args{
				clusterID:    "clusterOne",
				cachedClient: mgr.GetClient(),
			},
			wantErr: true,
		},
		{
			name: "should requeue instances and add cluster to sfcrRequeue",
			fields: fields{
				sfcrRequeue: []*clusterWatcher{},
				clusterWatchers: []*clusterWatcher{
					clusterOne,
				},
			},
			args: args{
				clusterID:    "clusterOne",
				cachedClient: client,
			},
			wantErr: false,
			setup: func() {
				labels := map[string]string{
					"state": "delete",
				}
				instance := _getDummyInstance()
				instance.Spec.ClusterID = clusterOne.clusterID
				instance.SetState("in progress")
				instance.SetLabels(labels)
				g.Expect(client.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
				g.Eventually(func() error {
					err = client.Get(context.TODO(), types.NamespacedName{Name: instance.Name, Namespace: constants.InteroperatorNamespace}, instance)
					if err != nil {
						return err
					}
					return nil
				}, timeout).Should(gomega.Succeed())
			},
			verify: func(wm *watchManager) {
				g.Expect(len(wm.clusterWatchers)).To(gomega.Equal(1))
				g.Expect(len(wm.sfcrRequeue)).To(gomega.Equal(1))
				g.Expect(client.Delete(context.TODO(), _getDummyInstance())).NotTo(gomega.HaveOccurred())
			},
		},
		{
			name: "should requeue bindings and add cluster to sfcrRequeue",
			fields: fields{
				sfcrRequeue: []*clusterWatcher{},
				clusterWatchers: []*clusterWatcher{
					clusterOne,
				},
			},
			args: args{
				clusterID:    "clusterOne",
				cachedClient: client,
			},
			wantErr: false,
			setup: func() {
				labels := map[string]string{
					"state": "update",
				}
				instance := _getDummyInstance()
				instance.Spec.ClusterID = clusterOne.clusterID
				instance.SetState("in progress")
				instance.SetLabels(labels)
				g.Expect(client.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
				g.Eventually(func() error {
					err = client.Get(context.TODO(), types.NamespacedName{Name: instance.Name, Namespace: constants.InteroperatorNamespace}, instance)
					if err != nil {
						return err
					}
					return nil
				}, timeout).Should(gomega.Succeed())

				labels = map[string]string{
					"state": "delete",
				}
				binding := _getDummyBinding()
				binding.SetState("in progress")
				binding.SetLabels(labels)
				g.Expect(client.Create(context.TODO(), binding)).NotTo(gomega.HaveOccurred())
				g.Eventually(func() error {
					err = client.Get(context.TODO(), types.NamespacedName{Name: binding.Name, Namespace: constants.InteroperatorNamespace}, binding)
					if err != nil {
						return err
					}
					return nil
				}, timeout).Should(gomega.Succeed())
			},
			verify: func(wm *watchManager) {
				g.Expect(len(wm.clusterWatchers)).To(gomega.Equal(1))
				g.Expect(len(wm.sfcrRequeue)).To(gomega.Equal(1))
				g.Expect(client.Delete(context.TODO(), _getDummyInstance())).NotTo(gomega.HaveOccurred())
				g.Expect(client.Delete(context.TODO(), _getDummyBinding())).NotTo(gomega.HaveOccurred())
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			wm := &watchManager{
				clusterWatchers: tt.fields.clusterWatchers,
				sfcrRequeue:     tt.fields.sfcrRequeue,
			}

			if tt.verify != nil {
				defer tt.verify(wm)
			}
			if err := wm.requeueSFCRs(tt.args.cachedClient, tt.args.clusterID); (err == nil) == tt.wantErr {
				t.Errorf("watchManager.isWatchingOnSfcrRequeue() = %v, want %v", err, tt.wantErr)
			}
		})
	}
}
