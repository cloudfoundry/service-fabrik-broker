package watches

import (
	"fmt"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

// CreateWatchChannel creates a channel and sets watches on all the
// clusters for all resources. Return the channel on which events are sent
// and a channel for stopping the watches
func CreateWatchChannel(clusterRegistry registry.ClusterRegistry,
	resources []osbv1alpha1.APIVersionKind) (<-chan event.GenericEvent, chan<- struct{}, error) {
	if clusterRegistry == nil {
		return nil, nil, errors.NewInputError("CreateWatchChannel", "clusterRegistry", nil)
	}

	events := make(chan event.GenericEvent, 1024)
	stopCh := make(chan struct{})

	gvkList := make([]schema.GroupVersionKind, len(resources))
	for i, resource := range resources {
		gv, err := schema.ParseGroupVersion(resource.APIVersion)
		if err != nil {
			log.Error(err, "unable to parse APIVersion. ignore watching", "APIVersion", resource.APIVersion)
			continue
		}
		gvk := gv.WithKind(resource.Kind)
		gvkList[i] = gvk
	}

	// Fetch the default client
	defaultCluster, err := clusterRegistry.GetClient("")
	if err != nil {
		log.Error(err, "unable to get defaultCluster client")
		return nil, nil, err
	}

	clusterList, err := clusterRegistry.ListClusters(nil)
	if err != nil {
		log.Error(err, "unable to get list clusters")
		return nil, nil, err
	}
	clusters := clusterList.Items
	clusterWatcherList := make([]*clusterWatcher, len(clusters))
	for i, cluster := range clusters {
		configBytes, err := cluster.GetKubeConfig(defaultCluster)
		if err != nil {
			log.Error(err, "unable to fetch kubeconfig. Not watching on cluster.",
				"clusterID", cluster.GetName(), "namespace", cluster.GetNamespace())
			continue
		}
		cfg, err := clientcmd.RESTConfigFromKubeConfig(configBytes)
		if err != nil {
			log.Error(err, "unable to decode kubeconfig. Not watching on cluster.",
				"clusterID", cluster.GetName())
			continue
		}

		dynamicClient, err := dynamic.NewForConfig(cfg)
		if err != nil {
			log.Error(err, "unable to create dynamic client. Not watching on cluster.",
				"clusterID", cluster.GetName())
			continue
		}

		discoveryClient, err := discovery.NewDiscoveryClientForConfig(cfg)
		if err != nil {
			log.Error(err, "unable to create discovery client. Not watching on cluster.",
				"clusterID", cluster.GetName())
			continue
		}

		stop := make(chan struct{})
		clusterWatcherList[i] = &clusterWatcher{
			clusterID:       cluster.GetName(),
			dynamicClient:   dynamicClient,
			discoveryClient: discoveryClient,
			gvkList:         gvkList,
			events:          events,
			stop:            stop,
			stopper:         stop,
		}
		err = clusterWatcherList[i].start()
		if err != nil {
			log.Error(err, "failed to start watch on cluster",
				"clusterID", cluster.GetName())
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
	}()
	return events, stopCh, nil
}

type clusterWatcher struct {
	clusterID       string
	dynamicClient   dynamic.Interface
	discoveryClient discovery.DiscoveryInterface
	gvkList         []schema.GroupVersionKind
	gvrList         []schema.GroupVersionResource
	watchers        []*watcher
	events          chan<- event.GenericEvent
	stop            <-chan struct{}
	// stopper is the write side of the stop channel. They should have the same value.
	stopper chan<- struct{}
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
				"clusterID", cw.clusterID, "gvk", gvk)
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
			clusterID:     cw.clusterID,
			dynamicClient: cw.dynamicClient,
			gvr:           gvr,
			events:        cw.events,
			stop:          stop,
			stopper:       stop,
		}
		err := cw.watchers[i].start()
		if err != nil {
			log.Error(err, "failed to start watch on cluster for resource",
				"clusterID", cw.clusterID, "gvr", gvr)
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
	clusterID     string
	dynamicClient dynamic.Interface
	gvr           schema.GroupVersionResource
	events        chan<- event.GenericEvent
	stop          <-chan struct{}
	// stopper is the write side of the stop channel. They should have the same value.
	stopper chan<- struct{}
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
			"clusterID", rw.clusterID, "gvr", rw.gvr)
		return err
	}

	log.V(1).Info("watch channel created", "clusterID", rw.clusterID, "gvr", rw.gvr)
	go func() {
		for {
			select {
			case watchEvent, ok := <-w.ResultChan():
				if !ok {
					w, err = resource.Watch(opts)
					if err != nil {
						log.Error(err, "failed to re-establish watch",
							"clusterID", rw.clusterID, "gvr", rw.gvr)
						return
					}
					log.V(1).Info("watch refreshed", "clusterID", rw.clusterID, "gvr", rw.gvr)
				}
				if watchEvent.Object == nil {
					continue
				}
				unstructuredObject, err := getUnstructured(watchEvent.Object)
				if err != nil {
					log.Error(err, "failed to process watch event",
						"clusterID", rw.clusterID, "gvr", rw.gvr, "watchEvent", watchEvent)
					continue
				}
				rw.events <- event.GenericEvent{
					Meta:   unstructuredObject,
					Object: watchEvent.Object,
				}
			case <-rw.stop:
				log.Info("stop called for watch. forcefully closing",
					"clusterID", rw.clusterID, "gvr", rw.gvr)
				w.Stop()
				return
			}
		}
	}()
	return nil
}

func getUnstructured(obj runtime.Object) (*unstructured.Unstructured, error) {
	if u, ok := obj.(*unstructured.Unstructured); ok {
		return u, nil
	}
	return nil, fmt.Errorf("Expected type *unstructured.Unstructured but got %v", obj)
}
