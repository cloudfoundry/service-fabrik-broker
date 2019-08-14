package watches

import (
	"os"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/config"

	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var log = logf.Log.WithName("watches")

// Manager is the Instance of watch manager
var manager *watchManager

// GetWatchChannel returns the channel for a controller to watch on
// Supported controller names are : instanceContoller and bindingContoller
func GetWatchChannel(controllerName string) (<-chan event.GenericEvent, error) {
	if manager == nil {
		return nil, errors.NewPreconditionError("GetWatchChannel", "watch manager not setup", nil)
	}
	return manager.getWatchChannel(controllerName)
}

// ReconfigureWatches updates the underlying watch channels if watch list
// is changed
func ReconfigureWatches() error {
	if manager == nil {
		return errors.NewPreconditionError("ReconfigureWatches", "watch manager not setup", nil)
	}
	return manager.reconfigureWatches()
}

// SetupWatchManager initializes the watch manager
func SetupWatchManager(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) error {
	if manager != nil {
		log.Info("Watch Manager already initialized")
		return nil
	}

	if kubeConfig == nil {
		return errors.NewInputError("NewWatchManager", "kubeConfig", nil)
	}

	if scheme == nil {
		return errors.NewInputError("NewWatchManager", "scheme", nil)
	}

	defaultCluster, err := client.New(kubeConfig, client.Options{
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

	cfgManager, err := config.New(kubeConfig, scheme, mapper)
	if err != nil {
		return err
	}

	clusterRegistry, err := registry.New(kubeConfig, scheme, mapper)
	if err != nil {
		return err
	}

	instanceWatches, bindingWatches, err := computeWatchList(defaultCluster, sfNamespace)
	if err != nil {
		log.Error(err, "Failed to compute watch lists")
		return err
	}

	wm := &watchManager{
		sfNamespace:     sfNamespace,
		defaultCluster:  defaultCluster,
		cfgManager:      cfgManager,
		clusterRegistry: clusterRegistry,
	}

	instanceContoller, err := newControllerWatcher(wm, "instanceContoller", instanceWatches)
	if err != nil {
		log.Error(err, "Failed to create watch for instance controller")
		return err
	}
	wm.instanceContoller = instanceContoller

	bindingContoller, err := newControllerWatcher(wm, "bindingContoller", bindingWatches)
	if err != nil {
		log.Error(err, "Failed to create watch for binding controller")
		return err
	}
	wm.bindingContoller = bindingContoller

	manager = wm
	return nil
}
