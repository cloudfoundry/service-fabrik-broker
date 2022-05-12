package watchmanager

import (
	"context"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/client/clientset/versioned"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

type clusterWatcher struct {
	clusterID      string
	cfg            *rest.Config
	timeoutSeconds int64

	instanceEvents chan event.GenericEvent
	bindingEvents  chan event.GenericEvent
	clusterEvents  chan event.GenericEvent

	// close this channel to stop watch for this cluster
	stop chan struct{}
}

func (cw *clusterWatcher) start() error {
	ctx := context.Background()
	opts := metav1.ListOptions{}
	if cw.timeoutSeconds == 0 {
		cw.timeoutSeconds = constants.MultiClusterWatchTimeout
	}

	opts.TimeoutSeconds = &cw.timeoutSeconds

	clientset, err := versioned.NewForConfig(cw.cfg)
	if err != nil {
		log.Error(err, "unable to create client. Not watching on cluster.",
			"clusterID", cw.clusterID)
		return err
	}
	instanceClient := clientset.OsbV1alpha1().SFServiceInstances("")
	bindingClient := clientset.OsbV1alpha1().SFServiceBindings("")
	clusterClient := clientset.ResourceV1alpha1().SFClusters(constants.InteroperatorNamespace)

	instanceWatch, err := instanceClient.Watch(ctx, opts)
	if err != nil {
		log.Error(err, "failed to establish watch for sfserviceinstance",
			"clusterID", cw.clusterID)
		return err
	}

	bindingWatch, err := bindingClient.Watch(ctx, opts)
	if err != nil {
		log.Error(err, "failed to establish watch for sfservicebinding",
			"clusterID", cw.clusterID)
		return err
	}

	clusterWatch, err := clusterClient.Watch(ctx, opts)
	if err != nil {
		log.Error(err, "failed to establish watch for sfcluster", "clusterID", cw.clusterID)
		return err
	}

	log.Info("watch channels created", "clusterID", cw.clusterID)
	go func() {
		for {
			select {
			case instanceEvent, ok := <-instanceWatch.ResultChan():
				if !ok {
					instanceWatch, err = instanceClient.Watch(ctx, opts)
					if err != nil {
						log.Error(err, "failed to re-establish watch for sfserviceinstance", "clusterID", cw.clusterID)
						_ = RemoveCluster(cw.clusterID)
						return
					}
					log.V(1).Info("watch refreshed for sfserviceinstance", "clusterID", cw.clusterID)
				}
				if instanceEvent.Object == nil {
					continue
				}
				object, ok := instanceEvent.Object.(kubernetes.Object)
				if !ok {
					log.Error(err, "failed to process watch event for sfserviceinstance", "clusterID",
						cw.clusterID, "instanceEvent", instanceEvent)
					continue
				}
				cw.instanceEvents <- event.GenericEvent{
					Object: object,
				}
			case bindingEvent, ok := <-bindingWatch.ResultChan():
				if !ok {
					bindingWatch, err = bindingClient.Watch(ctx, opts)
					if err != nil {
						log.Error(err, "failed to re-establish watch for sfservicebinding", "clusterID", cw.clusterID)
						_ = RemoveCluster(cw.clusterID)
						return
					}
					log.V(1).Info("watch refreshed for sfservicebinding", "clusterID", cw.clusterID)
				}
				if bindingEvent.Object == nil {
					continue
				}
				object, ok := bindingEvent.Object.(kubernetes.Object)
				if !ok {
					log.Error(err, "failed to process watch event for sfservicebinding", "clusterID",
						cw.clusterID, "sfservicebinding", bindingEvent)
					continue
				}
				cw.bindingEvents <- event.GenericEvent{
					Object: object,
				}
			case clusterEvent, ok := <-clusterWatch.ResultChan():
				if !ok {
					clusterWatch, err = clusterClient.Watch(ctx, opts)
					if err != nil {
						log.Error(err, "failed to re-establish watch for sfcluster", "clusterID", cw.clusterID)
						_ = RemoveCluster(cw.clusterID)
						return
					}
					log.V(1).Info("watch refreshed for sfcluster", "clusterID", cw.clusterID)
				}
				if clusterEvent.Object == nil {
					continue
				}

				object, ok := clusterEvent.Object.(kubernetes.Object)
				if !ok {
					log.Error(err, "failed to process watch event for sfcluster", "clusterID",
						cw.clusterID, "clusterEvent", clusterEvent)
					continue
				}

				cw.clusterEvents <- event.GenericEvent{
					Object: object,
				}
			case _, ok := <-cw.stop:
				if !ok {
					log.V(1).Info("stop called for cluster watch. forcefully closing", "clusterID",
						cw.clusterID)
					instanceWatch.Stop()
					bindingWatch.Stop()
					clusterWatch.Stop()
					return
				}
			}
		}
	}()
	return nil
}
