package watchmanager

import (
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
)

var log = logf.Log.WithName("watchmanager.mcd")

// Manager is the Instance of watch managerObject
var managerObject watchManagerInterface

// watchManager manages multi cluster watch
//go:generate mockgen -source manager.go -destination ./mock_manager.go -package watchmanager
type watchManagerInterface interface {
	getWatchChannel(resource string) (<-chan event.GenericEvent, error)
	addCluster(clusterID string) error
	removeCluster(clusterID string)
}

// GetWatchChannel returns the channel for a resource to watch on
// Supported resource names are : sfserviceinstances and sfservicebindings
func GetWatchChannel(resource string) (<-chan event.GenericEvent, error) {
	if managerObject == nil {
		return nil, errors.NewPreconditionError("GetWatchChannel", "watch manager not setup", nil)
	}
	log.Info("Getting watch channel", "resource", resource)
	return managerObject.getWatchChannel(resource)
}

// Initialize initializes the watch manager
func Initialize(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) error {
	if managerObject != nil {
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

	clusterRegistry, err := registry.New(kubeConfig, scheme, mapper)
	if err != nil {
		return err
	}

	cfgManager, err := config.New(kubeConfig, scheme, mapper)
	if err != nil {
		return err
	}

	instanceEvents := make(chan event.GenericEvent, 1024)
	bindingEvents := make(chan event.GenericEvent, 1024)
	clusterEvents := make(chan event.GenericEvent, 1024)
	stopCh := make(chan struct{})

	wm := &watchManager{
		defaultCluster:  defaultCluster,
		clusterRegistry: clusterRegistry,
		cfgManager:      cfgManager,
		clusterWatchers: make([]*clusterWatcher, 0),
		instanceEvents:  instanceEvents,
		bindingEvents:   bindingEvents,
		clusterEvents:   clusterEvents,
		stop:            stopCh,
	}

	managerObject = wm
	log.Info("Watch Manager initialized")
	return nil
}

// AddCluster add a cluster if not already exist to watch for
// sfserviceinstance and sfservicebinding
func AddCluster(clusterID string) error {
	if managerObject == nil {
		return errors.NewPreconditionError("AddCluster", "watch manager not setup", nil)
	}
	return managerObject.addCluster(clusterID)
}

// RemoveCluster stops watching on a cluster if already watching
func RemoveCluster(clusterID string) error {
	if managerObject == nil {
		return errors.NewPreconditionError("RemoveCluster", "watch manager not setup", nil)
	}

	log.Info("Removing cluster from watch manager", "clusterID", clusterID)

	// Call the removeCluster async as there is chance to get
	// blocked. This will block the caller of RemoveCluster if
	// we don't call removeCluster as go routine
	go managerObject.removeCluster(clusterID)
	return nil
}
