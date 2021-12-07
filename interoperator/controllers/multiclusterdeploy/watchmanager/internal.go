package watchmanager

import (
	"context"
	"sync"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"k8s.io/apimachinery/pkg/api/meta"
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
	sfcrRequeue     []*clusterWatcher
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

// Add instances/bindings with state "in progress" and label {"state" : "delete"} in the primary cluster
// if watch manager have watching on the given cluster
func (wm *watchManager) requeueSFCRs(cachedClient kubernetes.Client, clusterID string) error {
	ctx := context.TODO()
	if wm.isWatchingOnSfcrRequeue(clusterID) {
		log.Info("Already watching on instances in ", "clusterID", clusterID)
		return nil
	}
	cw := wm.getClusterWatch(clusterID)
	if cw == nil {
		err := errors.NewPreconditionError("requeueSFCRs", "cluster not found", nil)
		log.Error(err, "Watch manager not watching on cluster", "clusterID", clusterID)
		return err
	}

	sfserviceinstances := &osbv1alpha1.SFServiceInstanceList{}
	instance_options := &kubernetes.ListOptions{}
	kubernetes.MatchingLabels{"state": "delete"}.ApplyToList(instance_options)
	kubernetes.MatchingFields{"spec.clusterId": "clusterID"}.ApplyToList(instance_options)
	kubernetes.MatchingFields{"status.state": "in progress"}.ApplyToList(instance_options)

	for more := true; more; more = (sfserviceinstances.Continue != "") {
		err := cachedClient.List(ctx, sfserviceinstances, instance_options, kubernetes.Limit(constants.ListPaginationLimit),
			kubernetes.Continue(sfserviceinstances.Continue))
		if err != nil {
			log.Error(err, "error while fetching sfserviceinstances")
			return err
		}
		for _, sfserviceinstance := range sfserviceinstances.Items {
			instance := sfserviceinstance.DeepCopy()
			metaObject, err := meta.Accessor(instance)
			if err != nil {
				log.Error(err, "failed to process watch event for sfserviceinstance", "clusterID", cw.clusterID)
				continue
			}
			cw.instanceEvents <- event.GenericEvent{
				Meta:   metaObject,
				Object: instance,
			}
		}
	}

	sfservicebindings := &osbv1alpha1.SFServiceBindingList{}
	binding_options := &kubernetes.ListOptions{}
	kubernetes.MatchingLabels{"state": "delete"}.ApplyToList(binding_options)
	kubernetes.MatchingFields{"status.state": "in progress"}.ApplyToList(binding_options)

	for moreBindings := true; moreBindings; moreBindings = (sfservicebindings.Continue != "") {
		err := cachedClient.List(ctx, sfservicebindings, binding_options, kubernetes.Limit(constants.ListPaginationLimit),
			kubernetes.Continue(sfservicebindings.Continue))
		if err != nil {
			log.Error(err, "error while fetching sfservicebindings")
			return err
		}
		for _, sfservicebinding := range sfservicebindings.Items {
			if sf_clusterID, err := sfservicebinding.GetClusterID(cachedClient); err == nil && sf_clusterID == clusterID {
				binding := sfservicebinding.DeepCopy()
				metaBinding, err := meta.Accessor(binding)
				if err != nil {
					log.Error(err, "failed to process watch event for sfservicebinding", "clusterID",
						cw.clusterID)
					continue
				}
				cw.bindingEvents <- event.GenericEvent{
					Meta:   metaBinding,
					Object: binding,
				}
			}
		}
	}

	wm.mux.Lock()
	defer wm.mux.Unlock()
	wm.sfcrRequeue = append(wm.sfcrRequeue, cw)
	log.Info("Added cluster to watch requeues", "clusterID", clusterID)
	return nil
}

func (wm *watchManager) removeCluster(clusterID string) {
	wm.mux.Lock()
	defer wm.mux.Unlock()
	wm.removeClusterFromClusterWatchers(clusterID)
	wm.removeClusterFromSfcrRequeue(clusterID)
}

func (wm *watchManager) removeClusterFromClusterWatchers(clusterID string) {
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
	log.Info("Cluster not watched by ClusterWatchers. Ignoring remove",
		"clusterID", clusterID)
}

func (wm *watchManager) removeClusterFromSfcrRequeue(clusterID string) {
	l := len(wm.sfcrRequeue)
	for i, cw := range wm.sfcrRequeue {
		if cw.clusterID == clusterID {
			wm.sfcrRequeue[i] = wm.sfcrRequeue[l-1]
			wm.sfcrRequeue = wm.sfcrRequeue[:l-1]
			log.Info("Removed cluster from sfcr requeue", "clusterID", clusterID)
			return
		}
	}
	// Not found
	log.Info("Cluster is not added to sfcr requeue. Ignoring remove",
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

func (wm *watchManager) isWatchingOnSfcrRequeue(clusterID string) bool {
	wm.mux.Lock()
	defer wm.mux.Unlock()
	for _, cw := range wm.sfcrRequeue {
		if cw.clusterID == clusterID {
			return true
		}
	}
	return false
}

func (wm *watchManager) getClusterWatch(clusterID string) *clusterWatcher {
	wm.mux.Lock()
	defer wm.mux.Unlock()
	for _, cw := range wm.clusterWatchers {
		if cw.clusterID == clusterID {
			return cw
		}
	}
	return nil
}
