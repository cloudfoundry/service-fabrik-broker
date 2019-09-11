// +build multiclusterdeploy

package watchmanager

import (
	"os"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var log = logf.Log.WithName("watchmanager.mcd")

// Manager is the Instance of watch manager
var manager *watchManager

// GetWatchChannel returns the channel for a resource to watch on
// Supported resource names are : sfserviceinstances and sfservicebindings
func GetWatchChannel(resource string) (<-chan event.GenericEvent, error) {
	if manager == nil {
		return nil, errors.NewPreconditionError("GetWatchChannel", "watch manager not setup", nil)
	}
	log.Info("Getting watch channel", "resource", resource)
	return manager.getWatchChannel(resource)
}

// Initialize initializes the watch manager
func Initialize(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) error {
	if manager != nil {
		log.Info("Watch Manager already initialized")
		return nil
	}

	if kubeConfig == nil {
		return errors.NewInputError("SetupWatchManager", "kubeConfig", nil)
	}

	if scheme == nil {
		return errors.NewInputError("SetupWatchManager", "scheme", nil)
	}

	defaultCluster, err := kubernetes.New(kubeConfig, kubernetes.Options{
		Scheme: scheme,
		Mapper: mapper,
	})
	if err != nil {
		return err
	}

	sfNamespace := os.Getenv(constants.NamespaceEnvKey)
	if sfNamespace == "" {
		sfNamespace = constants.DefaultServiceFabrikNamespace
	}

	clusterRegistry, err := registry.New(kubeConfig, scheme, mapper)
	if err != nil {
		return err
	}
	instanceEvents := make(chan event.GenericEvent, 1024)
	bindingEvents := make(chan event.GenericEvent, 1024)
	stopCh := make(chan struct{})

	wm := &watchManager{
		sfNamespace:     sfNamespace,
		defaultCluster:  defaultCluster,
		clusterRegistry: clusterRegistry,
		clusterWatchers: make([]*clusterWatcher, 0),
		instanceEvents:  instanceEvents,
		bindingEvents:   bindingEvents,
		stop:            stopCh,
	}

	manager = wm
	log.Info("Watch Manager initialized")
	return nil
}

// AddCluster add a cluster if not already exist to watch for
// sfserviceinstance and sfservicebinding
func AddCluster(clusterID string) error {
	if manager == nil {
		return errors.NewPreconditionError("AddCluster", "watch manager not setup", nil)
	}
	return manager.addCluster(clusterID)
}

// RemoveCluster stops watching on a cluster if already watching
func RemoveCluster(clusterID string) error {
	if manager == nil {
		return errors.NewPreconditionError("RemoveCluster", "watch manager not setup", nil)
	}

	log.Info("Removing cluster from watch manager", "clusterID", clusterID)

	// Call the removeCluster async as there is chance to get
	// blocked. This will block the caller of RemoveCluster if
	// we don't call removeCluster as go routine
	go manager.removeCluster(clusterID)
	return nil
}
