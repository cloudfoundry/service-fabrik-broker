package watchmanager

import (
	"context"
	"testing"
	"time"

	"github.com/onsi/gomega"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

const timeout = time.Second * 2

func Test_clusterWatcher_start(t *testing.T) {
	g := gomega.NewGomegaWithT(t)

	setupClients(g)

	instance := _getDummyInstance()
	binding := _getDummyBinding()

	instanceEvents := make(chan event.GenericEvent, 1024)
	bindingEvents := make(chan event.GenericEvent, 1024)
	var host string
	type fields struct {
		clusterID      string
		cfg            *rest.Config
		timeoutSeconds int64
		instanceEvents chan event.GenericEvent
		bindingEvents  chan event.GenericEvent
		stop           chan struct{}
	}

	tests := []struct {
		name    string
		fields  fields
		setup   func(*clusterWatcher)
		cleanup func(*clusterWatcher)
		wantErr bool
	}{
		{
			name: "should fail to start if host is invalid",
			fields: fields{
				clusterID:      "clusterID",
				cfg:            cfg2,
				instanceEvents: instanceEvents,
				bindingEvents:  bindingEvents,
				stop:           make(chan struct{}),
			},
			setup: func(cw *clusterWatcher) {
				host = cw.cfg.Host
				cw.cfg.Host = "hello"
			},
			cleanup: func(cw *clusterWatcher) {
				cw.cfg.Host = host
				close(cw.stop)
			},
			wantErr: true,
		},
		{
			name: "should start watching on cluster two for bindings and instances",
			fields: fields{
				clusterID:      "clusterID",
				cfg:            cfg2,
				instanceEvents: instanceEvents,
				bindingEvents:  bindingEvents,
				stop:           make(chan struct{}),
			},
			cleanup: func(cw *clusterWatcher) {
				instance.SetResourceVersion("")
				binding.SetResourceVersion("")
				g.Expect(c2.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
				g.Expect(drainAllEvents(instanceEvents, timeout)).To(gomega.Equal(1))

				g.Expect(c2.Create(context.TODO(), binding)).NotTo(gomega.HaveOccurred())
				g.Expect(drainAllEvents(bindingEvents, timeout)).To(gomega.Equal(1))

				g.Expect(c2.Delete(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
				g.Expect(drainAllEvents(instanceEvents, timeout)).To(gomega.Equal(1))

				g.Expect(c2.Delete(context.TODO(), binding)).NotTo(gomega.HaveOccurred())
				g.Expect(drainAllEvents(bindingEvents, timeout)).To(gomega.Equal(1))
				close(cw.stop)
			},
			wantErr: false,
		},
		{
			name: "should refresh watches",
			fields: fields{
				clusterID:      "clusterID",
				cfg:            cfg2,
				timeoutSeconds: 3,
				instanceEvents: instanceEvents,
				bindingEvents:  bindingEvents,
				stop:           make(chan struct{}),
			},
			cleanup: func(cw *clusterWatcher) {
				instance.SetResourceVersion("")
				binding.SetResourceVersion("")
				g.Expect(c2.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
				g.Expect(c2.Create(context.TODO(), binding)).NotTo(gomega.HaveOccurred())

				g.Expect(drainAllEvents(instanceEvents, timeout)).NotTo(gomega.BeZero())
				g.Expect(drainAllEvents(bindingEvents, timeout)).NotTo(gomega.BeZero())

				g.Expect(c2.Delete(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
				g.Expect(drainAllEvents(instanceEvents, timeout)).NotTo(gomega.BeZero())

				g.Expect(c2.Delete(context.TODO(), binding)).NotTo(gomega.HaveOccurred())
				g.Expect(drainAllEvents(bindingEvents, timeout)).NotTo(gomega.BeZero())
				close(cw.stop)
			},
			wantErr: false,
		},
		{
			name: "should stop watching on cluster when stop is closed",
			fields: fields{
				clusterID:      "clusterID",
				cfg:            cfg2,
				instanceEvents: instanceEvents,
				bindingEvents:  bindingEvents,
				stop:           make(chan struct{}),
			},
			cleanup: func(cw *clusterWatcher) {
				close(cw.stop)
				g.Expect(drainAllEvents(instanceEvents, timeout)).To(gomega.BeZero())
				g.Expect(drainAllEvents(bindingEvents, timeout)).To(gomega.BeZero())
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cw := &clusterWatcher{
				clusterID:      tt.fields.clusterID,
				cfg:            tt.fields.cfg,
				timeoutSeconds: tt.fields.timeoutSeconds,
				instanceEvents: tt.fields.instanceEvents,
				bindingEvents:  tt.fields.bindingEvents,
				stop:           tt.fields.stop,
			}
			if tt.setup != nil {
				tt.setup(cw)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(cw)
			}
			if err := cw.start(); (err != nil) != tt.wantErr {
				t.Errorf("clusterWatcher.start() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

// drainAllEvents reads from the events channel until no new events comes
// for remainingTime duration. Returns the number of events drained
func drainAllEvents(events <-chan event.GenericEvent, remainingTime time.Duration) int {
	// Drain all requests
	select {
	case <-events:
		return 1 + drainAllEvents(events, remainingTime)
	case <-time.After(remainingTime):
		return 0
	}
}
