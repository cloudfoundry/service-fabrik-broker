// +build !multiclusterdeploy

package watchmanager

import (
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/event"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var log = logf.Log.WithName("watchmanager.mcd")

// GetWatchChannel returns the channel for a controller to watch on
// Supported controller names are : instanceContoller and bindingContoller
func GetWatchChannel(controllerName string) (<-chan event.GenericEvent, error) {
	log.Info("Watch Manager not supported by the build tags")
	return nil, errors.NewPreconditionError("GetWatchChannel", "build does not support watch manager", nil)
}

// Initialize initializes the watch manager
func Initialize(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) error {
	log.Info("Watch Manager not supported by the build tags")
	return nil
}

// AddCluster add a cluster if not already exist to watch for
// sfserviceinstance and sfservicebinding
func AddCluster(clusterID string) error {
	log.Info("Watch Manager not supported by the build tags")
	return errors.NewPreconditionError("AddCluster", "build does not support watch manager", nil)
}

// RemoveCluster stops watching on a cluster if already watching
func RemoveCluster(clusterID string) error {
	log.Info("Watch Manager not supported by the build tags")
	return errors.NewPreconditionError("RemoveCluster", "build does not support watch manager", nil)
}
