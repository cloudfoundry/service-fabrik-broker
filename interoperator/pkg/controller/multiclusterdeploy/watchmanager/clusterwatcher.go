package watchmanager

import (
	"sync"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/client/clientset/versioned"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/tools/clientcmd"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

type clusterWatcher struct {
	sfCluster      *resourcev1alpha1.SFCluster
	defaultCluster kubernetes.Client

	instanceEvents chan event.GenericEvent
	bindingEvents  chan event.GenericEvent

	// close this channel to stop watch for this cluster
	stop      chan struct{}
	waitgroup *sync.WaitGroup
}

func (cw *clusterWatcher) start() error {
	opts := metav1.ListOptions{}
	var timeoutSeconds int64
	timeoutSeconds = constants.MultiClusterWatchTimeout
	opts.TimeoutSeconds = &timeoutSeconds

	cluster := cw.sfCluster

	configBytes, err := cluster.GetKubeConfig(cw.defaultCluster)
	if err != nil {
		log.Error(err, "unable to fetch kubeconfig. Not watching on cluster.",
			"clusterID", cluster.GetName(), "namespace", cluster.GetNamespace())
		return err
	}
	cfg, err := clientcmd.RESTConfigFromKubeConfig(configBytes)
	if err != nil {
		log.Error(err, "unable to decode kubeconfig. Not watching on cluster.",
			"clusterID", cluster.GetName())
		return err
	}

	clientset, err := versioned.NewForConfig(cfg)
	if err != nil {
		log.Error(err, "unable to create client. Not watching on cluster.",
			"clusterID", cluster.GetName())
		return err
	}
	instanceClient := clientset.OsbV1alpha1().SFServiceInstances("")
	bindingClient := clientset.OsbV1alpha1().SFServiceBindings("")

	instanceWatch, err := instanceClient.Watch(opts)
	if err != nil {
		log.Error(err, "failed to establish watch for sfserviceinstance",
			"clusterID", cluster.GetName())
		return err
	}

	bindingWatch, err := bindingClient.Watch(opts)
	if err != nil {
		log.Error(err, "failed to establish watch for sfservicebinding",
			"clusterID", cluster.GetName())
		return err
	}

	log.Info("watch channels created", "clusterID", cluster.GetName())
	cw.waitgroup.Add(1)
	go func() {
		defer cw.waitgroup.Done()
		for {
			select {
			case instanceEvent, ok := <-instanceWatch.ResultChan():
				if !ok {
					instanceWatch, err = instanceClient.Watch(opts)
					if err != nil {
						log.Error(err, "failed to re-establish watch for sfserviceinstance", "clusterID", cluster.GetName())
						continue
					}
					log.V(1).Info("watch refreshed for sfserviceinstance", "clusterID", cluster.GetName())
				}
				if instanceEvent.Object == nil {
					continue
				}
				metaObject, err := meta.Accessor(instanceEvent.Object)
				if err != nil {
					log.Error(err, "failed to process watch event for sfserviceinstance", "clusterID",
						cluster.GetName(), "instanceEvent", instanceEvent)
					continue
				}
				cw.instanceEvents <- event.GenericEvent{
					Meta:   metaObject,
					Object: instanceEvent.Object,
				}
			case bindingEvent, ok := <-bindingWatch.ResultChan():
				if !ok {
					bindingWatch, err = bindingClient.Watch(opts)
					if err != nil {
						log.Error(err, "failed to re-establish watch for sfservicebinding", "clusterID", cluster.GetName())
						continue
					}
					log.V(1).Info("watch refreshed for sfservicebinding", "clusterID", cluster.GetName())
				}
				if bindingEvent.Object == nil {
					continue
				}
				metaObject, err := meta.Accessor(bindingEvent.Object)
				if err != nil {
					log.Error(err, "failed to process watch event for sfservicebinding", "clusterID",
						cluster.GetName(), "bindingEvent", bindingEvent)
					continue
				}
				cw.bindingEvents <- event.GenericEvent{
					Meta:   metaObject,
					Object: bindingEvent.Object,
				}
			case _, ok := <-cw.stop:
				if !ok {
					log.V(1).Info("stop called for cluster watch. forcefully closing", "clusterID",
						cluster.GetName())
					instanceWatch.Stop()
					bindingWatch.Stop()
					return
				}
			}
		}
	}()
	return nil
}
