package watchmanager

import (
	"context"
	"reflect"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sync"
	"testing"

	gomock "github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/manager"
)

func TestGetWatchChannel(t *testing.T) {
	var ctrl *gomock.Controller

	type args struct {
		resource string
	}
	tests := []struct {
		name    string
		args    args
		want    <-chan event.GenericEvent
		wantErr bool
		setup   func()
		cleanup func()
	}{
		{
			name: "should fail if manager is not setup",
			args: args{
				resource: "foo",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "should call manager getWatchChannel",
			args: args{
				resource: "foo",
			},
			want:    nil,
			wantErr: false,
			setup: func() {
				ctrl = gomock.NewController(t)
				mockwatchManager := NewMockwatchManagerInterface(ctrl)
				managerObject = mockwatchManager
				mockwatchManager.EXPECT().getWatchChannel("foo").Return(nil, nil).Times(1)
			},
			cleanup: func() {
				managerObject = nil
				defer ctrl.Finish()
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			if tt.cleanup != nil {
				defer tt.cleanup()
			}
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
	g := gomega.NewGomegaWithT(t)
	var ctrl *gomock.Controller

	var mockwatchManager *MockwatchManagerInterface
	setupClients(g)

	type args struct {
		kubeConfig *rest.Config
		scheme     *runtime.Scheme
		mapper     meta.RESTMapper
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
		setup   func()
		cleanup func()
	}{
		{
			name:    "should do nothing if manager already initialized",
			wantErr: false,
			setup: func() {
				ctrl = gomock.NewController(t)
				mockwatchManager = NewMockwatchManagerInterface(ctrl)
				managerObject = mockwatchManager
			},
			cleanup: func() {
				g.Expect(managerObject).To(gomega.Equal(mockwatchManager))
				managerObject = nil
				defer ctrl.Finish()
			},
		},
		{
			name:    "should fail if kubeconfig is nil",
			wantErr: true,
		},
		{
			name:    "should fail if scheme is nil",
			wantErr: true,
			args: args{
				kubeConfig: cfg1,
			},
		},
		{
			name:    "should initialize watch manager",
			wantErr: false,
			args: args{
				kubeConfig: cfg1,
				scheme:     scheme.Scheme,
				mapper:     mapper1,
			},
			setup: func() {
				managerObject = nil
			},
			cleanup: func() {
				g.Expect(managerObject).NotTo(gomega.BeNil())
				managerObject = nil
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			if tt.cleanup != nil {
				defer tt.cleanup()
			}
			if err := Initialize(tt.args.kubeConfig, tt.args.scheme, tt.args.mapper); (err != nil) != tt.wantErr {
				t.Errorf("Initialize() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestAddCluster(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	var ctrl *gomock.Controller

	mgr, err := manager.New(cfg1, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	cancelMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		cancelMgr()
		mgrStopped.Wait()
	}()

	type args struct {
		clusterID    string
		cachedClient kubernetes.Client
	}

	tests := []struct {
		name    string
		args    args
		wantErr bool
		setup   func()
		cleanup func()
	}{
		{
			name: "should fail if manager is not setup",
			args: args{
				clusterID:    "foo",
				cachedClient: mgr.GetClient(),
			},
			wantErr: true,
		},
		{
			name: "should call manager addCluster",
			args: args{
				clusterID:    "foo",
				cachedClient: mgr.GetClient(),
			},
			wantErr: false,
			setup: func() {
				ctrl = gomock.NewController(t)
				mockwatchManager := NewMockwatchManagerInterface(ctrl)
				managerObject = mockwatchManager
				mockwatchManager.EXPECT().addCluster("foo").Return(nil).Times(1)
				mockwatchManager.EXPECT().requeueSFCRs(mgr.GetClient(), "foo").Return(nil).Times(1)

			},
			cleanup: func() {
				managerObject = nil
				defer ctrl.Finish()
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			if tt.cleanup != nil {
				defer tt.cleanup()
			}
			if err := AddCluster(tt.args.cachedClient, tt.args.clusterID); (err != nil) != tt.wantErr {
				t.Errorf("AddCluster() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestRemoveCluster(t *testing.T) {
	var ctrl *gomock.Controller
	type args struct {
		clusterID string
	}
	var wg sync.WaitGroup
	tests := []struct {
		name    string
		args    args
		wantErr bool
		setup   func()
		cleanup func()
	}{
		{
			name: "should fail if manager is not setup",
			args: args{
				clusterID: "foo",
			},
			wantErr: true,
		},
		{
			name: "should call manager removeCluster",
			args: args{
				clusterID: "foo",
			},
			wantErr: false,
			setup: func() {
				ctrl = gomock.NewController(t)
				mockwatchManager := NewMockwatchManagerInterface(ctrl)
				managerObject = mockwatchManager
				wg.Add(1)
				mockwatchManager.EXPECT().removeCluster("foo").Do(func(clusterID string) {
					wg.Done()
				}).Times(1)
			},
			cleanup: func() {
				wg.Wait()
				managerObject = nil
				defer ctrl.Finish()
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			if tt.cleanup != nil {
				defer tt.cleanup()
			}
			if err := RemoveCluster(tt.args.clusterID); (err != nil) != tt.wantErr {
				t.Errorf("RemoveCluster() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

// StartTestManager adds recFn
func StartTestManager(mgr manager.Manager, g *gomega.GomegaWithT) (context.CancelFunc, *sync.WaitGroup) {
	ctx, cancel := context.WithCancel(context.Background())
	wg := &sync.WaitGroup{}
	wg.Add(1)
	go func() {
		defer wg.Done()
		g.Expect(mgr.Start(ctx)).NotTo(gomega.HaveOccurred())
	}()
	return cancel, wg
}
