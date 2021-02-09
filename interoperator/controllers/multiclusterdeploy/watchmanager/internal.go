package watchmanager

import (
	"sync"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"k8s.io/client-go/rest"
	ctrl "sigs.k8s.io/controller-runtime"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

type watchManager struct {
	defaultCluster  kubernetes.Client
	clusterRegistry registry.ClusterRegistry
	cfgManager      config.Config

	clusterWatchers []*clusterWatcher
	mux             sync.Mutex // Locking clusterWatchers array

	instanceEvents chan event.GenericEvent
	bindingEvents  chan event.GenericEvent
	clusterEvents  chan event.GenericEvent

	// close this channel to stop watch manager
	stop chan struct{}
}

func (wm *watchManager) getWatchChannel(resource string) (<-chan event.GenericEvent, error) {
	switch resource {
	case "sfserviceinstances":
		if wm == nil || wm.instanceEvents == nil {
			return nil, errors.NewPreconditionError("GetWatchChannel", "watch manager not setup", nil)
		}
		return wm.instanceEvents, nil
	case "sfservicebindings":
		if wm == nil || wm.bindingEvents == nil {
			return nil, errors.NewPreconditionError("GetWatchChannel", "watch manager not setup", nil)
		}
		return wm.bindingEvents, nil
	case "sfclusters":
		if wm == nil || wm.clusterEvents == nil {
			return nil, errors.NewPreconditionError("GetWatchChannel", "watch manager not setup", nil)
		}
		return wm.clusterEvents, nil
	}
	return nil, errors.NewInputError("GetWatchChannel", "resource", nil)
}

func (wm *watchManager) addCluster(clusterID string) error {
	if wm.isWatchingOnCluster(clusterID) {
		// already watching on cluster
		log.Info("Already watching on cluster", "clusterID", clusterID)
		return nil
	}
	cluster, err := wm.clusterRegistry.GetCluster(clusterID)
	if err != nil {
		log.Error(err, "unable to fetch sfcluster", "clusterID", clusterID)
		return err
	}

	var cfg *rest.Config
	interoperatorCfg := wm.cfgManager.GetConfig()
	currPrimaryClusterID := interoperatorCfg.PrimaryClusterID

	if clusterID == currPrimaryClusterID {
		// Use in cluster config
		cfg, err = ctrl.GetConfig()
	} else {
		// Get config from secret
		cfg, err = cluster.GetKubeConfig(wm.defaultCluster)
	}
	if err != nil {
		log.Error(err, "unable to get sfcluster config", "clusterID", clusterID)
		return err
	}

	stopCh := make(chan struct{})

	cw := &clusterWatcher{
		clusterID:      clusterID,
		cfg:            cfg,
		instanceEvents: wm.instanceEvents,
		bindingEvents:  wm.bindingEvents,
		clusterEvents:  wm.clusterEvents,
		stop:           stopCh,
	}
	err = cw.start()
	if err != nil {
		log.Error(err, "unable to start cluster watcher", "clusterID", clusterID)
		return err
	}

	wm.mux.Lock()
	defer wm.mux.Unlock()
	wm.clusterWatchers = append(wm.clusterWatchers, cw)
	log.Info("Added cluster to watch manager", "clusterID", clusterID)
	return nil
}

func (wm *watchManager) removeCluster(clusterID string) {
	wm.mux.Lock()
	defer wm.mux.Unlock()
	l := len(wm.clusterWatchers)
	for i, cw := range wm.clusterWatchers {
		if cw.clusterID == clusterID {
			close(cw.stop)
			wm.clusterWatchers[i] = wm.clusterWatchers[l-1]
			wm.clusterWatchers = wm.clusterWatchers[:l-1]
			log.Info("Removed cluster from watch manager", "clusterID", clusterID)
			return
		}
	}
	// Not found
	log.Info("Cluster not watched by watch manager. Ignoring remove",
		"clusterID", clusterID)
}

func (wm *watchManager) isWatchingOnCluster(clusterID string) bool {
	wm.mux.Lock()
	defer wm.mux.Unlock()
	for _, cw := range wm.clusterWatchers {
		if cw.clusterID == clusterID {
			return true
		}
	}
	return false
}
