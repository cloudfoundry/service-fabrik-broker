package watchmanager

import (
	"context"
	"testing"
	"time"

	"github.com/onsi/gomega"
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
	stopCh := make(chan struct{})
	var host string
	cw := &clusterWatcher{
		clusterID:      "clusterID",
		cfg:            cfg2,
		instanceEvents: instanceEvents,
		bindingEvents:  bindingEvents,
		stop:           stopCh,
	}
	tests := []struct {
		name    string
		cw      *clusterWatcher
		setup   func()
		cleanup func()
		wantErr bool
	}{
		{
			name: "should fail to start if host is invalid",
			cw:   cw,
			setup: func() {
				host = cw.cfg.Host
				cw.cfg.Host = "hello"
			},
			cleanup: func() {
				cw.cfg.Host = host
			},
			wantErr: true,
		},
		{
			name: "should start watching on cluster two for bindings and instances",
			cw:   cw,
			cleanup: func() {
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
			},
			wantErr: false,
		},
		{
			name: "should refresh watches",
			cw:   cw,
			setup: func() {
				cw.timeoutSeconds = 3
			},
			cleanup: func() {
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
				cw.timeoutSeconds = 0
			},
			wantErr: false,
		},
		{
			name: "should stop watching on cluster when stop is closed",
			cw:   cw,
			cleanup: func() {
				close(cw.stop)
				g.Expect(drainAllEvents(instanceEvents, timeout)).To(gomega.BeZero())
				g.Expect(drainAllEvents(bindingEvents, timeout)).To(gomega.BeZero())
			},
			wantErr: false,
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
			if err := tt.cw.start(); (err != nil) != tt.wantErr {
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
