package watches

import (
	"os"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/config"

	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

func (wm *watchManager) getWatchChannel(controllerName string) (<-chan event.GenericEvent, error) {
	switch controllerName {
	case "instanceContoller":
		if wm == nil || wm.instanceContoller == nil || wm.instanceContoller.events == nil {
			return nil, errors.NewPreconditionError("GetWatchChannel", "watch manager not setup", nil)
		}
		return wm.instanceContoller.events, nil
	case "bindingContoller":
		if wm == nil || wm.bindingContoller == nil || wm.bindingContoller.events == nil {
			return nil, errors.NewPreconditionError("GetWatchChannel", "watch manager not setup", nil)
		}
		return wm.bindingContoller.events, nil
	}
	return nil, errors.NewInputError("GetWatchChannel", "controllerName", nil)
}

func (wm *watchManager) reconfigureWatches() error {
	if wm == nil {
		return errors.NewPreconditionError("ReconfigureWatches", "watch manager not setup", nil)
	}
	instanceWatches, bindingWatches, err := computeWatchList(wm.defaultCluster, wm.sfNamespace)
	if err != nil {
		log.Error(err, "Failed to compute watch lists")
		return err
	}
	isUpdated, err := updateWatchConfig(wm.cfgManager, instanceWatches, bindingWatches)
	if err != nil {
		return err
	}

	if isUpdated {
		wm.instanceContoller.resources = instanceWatches
		wm.instanceContoller.reconfigure <- struct{}{}

		wm.bindingContoller.resources = bindingWatches
		wm.bindingContoller.reconfigure <- struct{}{}

		<-wm.instanceContoller.reconfigureSuccess
		<-wm.bindingContoller.reconfigureSuccess
		log.Info("ReconfigureWatches completed")
	}

	return nil
}

type watchManager struct {
	sfNamespace       string
	defaultCluster    kubernetes.Client
	cfgManager        config.Config
	clusterRegistry   registry.ClusterRegistry
	instanceContoller *controllerWatcher
	bindingContoller  *controllerWatcher
}

type controllerWatcher struct {
	name            string
	sfNamespace     string
	defaultCluster  kubernetes.Client
	cfgManager      config.Config
	clusterRegistry registry.ClusterRegistry
	resources       []osbv1alpha1.APIVersionKind

	// objects from _events are passed through to events
	events  chan event.GenericEvent
	_events <-chan event.GenericEvent

	// write to stop is passed through to _stop
	stop  chan struct{}
	_stop chan<- struct{}

	// to reconfigure watch channel
	reconfigure        chan struct{}
	reconfigureSuccess chan struct{}
}

func newControllerWatcher(wm *watchManager, name string, resources []osbv1alpha1.APIVersionKind) (*controllerWatcher, error) {
	events := make(chan event.GenericEvent, 1024)
	stopCh := make(chan struct{})
	reconfigure := make(chan struct{})
	reconfigureSuccess := make(chan struct{})
	controller := &controllerWatcher{
		name:               name,
		sfNamespace:        wm.sfNamespace,
		defaultCluster:     wm.defaultCluster,
		cfgManager:         wm.cfgManager,
		clusterRegistry:    wm.clusterRegistry,
		resources:          resources,
		events:             events,
		stop:               stopCh,
		reconfigure:        reconfigure,
		reconfigureSuccess: reconfigureSuccess,
	}
	_events, _stop, err := createWatchChannel(name, controller.defaultCluster,
		controller.clusterRegistry, controller.resources)
	if err != nil {
		return nil, err
	}
	controller._events = _events
	controller._stop = _stop

	go controller.start()
	return controller, nil
}

func (controller *controllerWatcher) start() {
	var err error
	var _newEvents <-chan event.GenericEvent
	var _newStop chan<- struct{}
	stopped := false
	for {
		select {
		case watchEvent, ok := <-controller._events:
			if !ok {
				// channel closed
				if _newEvents == nil || _newStop == nil {
					log.Info("successfully stopped watch", "controller", controller.name)
					return
				}
				// Recreate was called. Switch to new channels
				controller._events = _newEvents
				controller._stop = _newStop
				log.Info("Reconfigured watch. Successfully switched watch channel", "controller", controller.name)
				controller.reconfigureSuccess <- struct{}{}
				continue
			}
			//pass through the event
			controller.events <- watchEvent
		case <-controller.stop:
			stopped = true
			_newEvents = nil
			_newStop = nil
			controller._stop <- struct{}{}
			log.Info("stop called for watch. forcefully closing",
				"controller", controller.name)
		case <-controller.reconfigure:
			if stopped {
				log.Info("stop already called for watch. not recreating",
					"controller", controller.name)
				continue
			}
			_newEvents, _newStop, err = createWatchChannel(controller.name, controller.defaultCluster,
				controller.clusterRegistry, controller.resources)
			if err != nil {
				log.Error(err, "Failed to recreate watch channel. Fatal.",
					"controller", controller.name)
				os.Exit(1)
			}
			controller._stop <- struct{}{}
		}
	}
}
