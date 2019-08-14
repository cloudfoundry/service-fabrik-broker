package watches

import (
	"sync"

	"k8s.io/apimachinery/pkg/api/meta"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/tools/clientcmd"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

// createWatchChannel creates a channel and sets watches on all the
// clusters for all resources. Return the channel on which events are sent
// and a channel for stopping the watches
func createWatchChannel(controllerName string, defaultCluster kubernetes.Client, clusterRegistry registry.ClusterRegistry,
	resources []osbv1alpha1.APIVersionKind) (<-chan event.GenericEvent, chan<- struct{}, error) {

	events := make(chan event.GenericEvent, 1024)
	stopCh := make(chan struct{})
	var waitgroup sync.WaitGroup

	gvkList := make([]schema.GroupVersionKind, len(resources))
	for i, resource := range resources {
		gv, err := schema.ParseGroupVersion(resource.APIVersion)
		if err != nil {
			log.Error(err, "unable to parse APIVersion. ignore watching", "APIVersion",
				resource.APIVersion, "controller", controllerName)
			continue
		}
		gvk := gv.WithKind(resource.Kind)
		gvkList[i] = gvk
	}

	clusterList, err := clusterRegistry.ListClusters(nil)
	if err != nil {
		log.Error(err, "unable to get list clusters", "controller", controllerName)
		return nil, nil, err
	}
	clusters := clusterList.Items
	clusterWatcherList := make([]*clusterWatcher, len(clusters))
	for i, cluster := range clusters {
		configBytes, err := cluster.GetKubeConfig(defaultCluster)
		if err != nil {
			log.Error(err, "unable to fetch kubeconfig. Not watching on cluster.",
				"clusterID", cluster.GetName(), "namespace", cluster.GetNamespace(), "controller", controllerName)
			continue
		}
		cfg, err := clientcmd.RESTConfigFromKubeConfig(configBytes)
		if err != nil {
			log.Error(err, "unable to decode kubeconfig. Not watching on cluster.",
				"clusterID", cluster.GetName(), "controller", controllerName)
			continue
		}

		dynamicClient, err := dynamic.NewForConfig(cfg)
		if err != nil {
			log.Error(err, "unable to create dynamic client. Not watching on cluster.",
				"clusterID", cluster.GetName(), "controller", controllerName)
			continue
		}

		discoveryClient, err := discovery.NewDiscoveryClientForConfig(cfg)
		if err != nil {
			log.Error(err, "unable to create discovery client. Not watching on cluster.",
				"clusterID", cluster.GetName(), "controller", controllerName)
			continue
		}

		stop := make(chan struct{})
		clusterWatcherList[i] = &clusterWatcher{
			controllerName:  controllerName,
			clusterID:       cluster.GetName(),
			dynamicClient:   dynamicClient,
			discoveryClient: discoveryClient,
			gvkList:         gvkList,
			events:          events,
			stop:            stop,
			stopper:         stop,
			waitgroup:       &waitgroup,
		}
		err = clusterWatcherList[i].start()
		if err != nil {
			log.Error(err, "failed to start watch on cluster",
				"clusterID", cluster.GetName(), "controller", controllerName)
			continue
		}
	}
	go func() {
		<-stopCh
		for _, clusterWatcher := range clusterWatcherList {
			if clusterWatcher != nil {
				clusterWatcher.stopper <- struct{}{}
			}
		}
		// close events after all clusterWatchers are done
		waitgroup.Wait()
		close(events)
		log.Info("closed watch channel", "controller", controllerName)

	}()
	log.Info("created watch channel", "controller", controllerName)
	return events, stopCh, nil
}

type clusterWatcher struct {
	controllerName  string
	clusterID       string
	dynamicClient   dynamic.Interface
	discoveryClient discovery.DiscoveryInterface
	gvkList         []schema.GroupVersionKind
	gvrList         []schema.GroupVersionResource
	watchers        []*watcher
	events          chan<- event.GenericEvent
	stop            <-chan struct{}
	// stopper is the write side of the stop channel. They should have the same value.
	stopper   chan<- struct{}
	waitgroup *sync.WaitGroup
}

func (cw *clusterWatcher) computeGVRList() {
	has := func(verbs []string, verb string) bool {
		for _, val := range verbs {
			if val == verb {
				return true
			}
		}
		return false
	}
	gvrList := make([]schema.GroupVersionResource, 0)
	for _, gvk := range cw.gvkList {
		apiResourceList, err := cw.discoveryClient.ServerResourcesForGroupVersion(gvk.GroupVersion().String())
		if err != nil {
			log.Error(err, "failed to discover resource for watch",
				"clusterID", cw.clusterID, "gvk", gvk, "controller", cw.controllerName)
			continue
		}
		for _, apiResource := range apiResourceList.APIResources {
			if gvk.Kind == apiResource.Kind && has(apiResource.Verbs, "watch") {
				gvrList = append(gvrList, gvk.GroupVersion().WithResource(apiResource.Name))
			}
		}
	}
	cw.gvrList = gvrList
}

func (cw *clusterWatcher) start() error {
	cw.computeGVRList()
	cw.watchers = make([]*watcher, len(cw.gvrList))
	for i, gvr := range cw.gvrList {
		stop := make(chan struct{})
		cw.watchers[i] = &watcher{
			controllerName: cw.controllerName,
			clusterID:      cw.clusterID,
			dynamicClient:  cw.dynamicClient,
			gvr:            gvr,
			events:         cw.events,
			stop:           stop,
			stopper:        stop,
			waitgroup:      cw.waitgroup,
		}
		err := cw.watchers[i].start()
		if err != nil {
			log.Error(err, "failed to start watch on cluster for resource",
				"clusterID", cw.clusterID, "gvr", gvr, "controller", cw.controllerName)
			continue
		}
	}
	go func() {
		<-cw.stop
		for _, watcher := range cw.watchers {
			watcher.stopper <- struct{}{}
		}
	}()
	return nil
}

type watcher struct {
	controllerName string
	clusterID      string
	dynamicClient  dynamic.Interface
	gvr            schema.GroupVersionResource
	events         chan<- event.GenericEvent
	stop           <-chan struct{}
	// stopper is the write side of the stop channel. They should have the same value.
	stopper   chan<- struct{}
	waitgroup *sync.WaitGroup
}

func (rw *watcher) start() error {
	opts := metav1.ListOptions{}
	var timeoutSeconds int64
	timeoutSeconds = constants.DynamicWatchTimeout
	opts.TimeoutSeconds = &timeoutSeconds

	resource := rw.dynamicClient.Resource(rw.gvr)
	w, err := resource.Watch(opts)
	if err != nil {
		log.Error(err, "failed to establish watch",
			"clusterID", rw.clusterID, "gvr", rw.gvr, "controller", rw.controllerName)
		return err
	}

	log.Info("watch channel created", "controller", rw.controllerName, "clusterID", rw.clusterID, "gvr",
		rw.gvr)
	rw.waitgroup.Add(1)
	go func() {
		defer rw.waitgroup.Done()
		for {
			select {
			case watchEvent, ok := <-w.ResultChan():
				if !ok {
					w, err = resource.Watch(opts)
					if err != nil {
						log.Error(err, "failed to re-establish watch", "clusterID", rw.clusterID,
							"gvr", rw.gvr, "controller", rw.controllerName)
						return
					}
					log.V(1).Info("watch refreshed", "clusterID", rw.clusterID, "gvr", rw.gvr,
						"controller", rw.controllerName)
				}
				if watchEvent.Object == nil {
					continue
				}
				metaObject, err := meta.Accessor(watchEvent.Object)
				if err != nil {
					log.Error(err, "failed to process watch event", "clusterID", rw.clusterID,
						"gvr", rw.gvr, "watchEvent", watchEvent, "controller", rw.controllerName)
					continue
				}
				rw.events <- event.GenericEvent{
					Meta:   metaObject,
					Object: watchEvent.Object,
				}
			case <-rw.stop:
				log.V(1).Info("stop called for watch. forcefully closing", "clusterID",
					rw.clusterID, "gvr", rw.gvr, "controller", rw.controllerName)
				w.Stop()
				return
			}
		}
	}()
	return nil
}
