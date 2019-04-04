package factory

import (
	"fmt"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	"k8s.io/client-go/rest"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/config"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var log = logf.Log.WithName("cluster.factory")

// ClusterFactory sets up k8s clusters and gets client for them
//go:generate mockgen -source factory.go -destination ./mock_factory/mock_factory.go
type ClusterFactory interface {
	// TODO pass the entire SFServiceInstance and SfServiceBinding
	GetCluster(instanceID, bindingID, serviceID, planID string) (kubernetes.Client, error)
}

type clusterFactory struct {
	mgr manager.Manager
	cfg *rest.Config
}

// New returns a new ClusterFactory using the provided manager
func New(mgr manager.Manager) (ClusterFactory, error) {
	if mgr == nil {
		err := fmt.Errorf("manager cannot be nil")
		log.Error(err, "New: manager argument is nil")
		return nil, errors.NewClusterFactoryError("nil argument found", err)
	}
	return &clusterFactory{
		mgr: mgr,
	}, nil

}

// GetCluster gets a cluster and returns a kubernetes client for it
func (f *clusterFactory) GetCluster(instanceID, bindingID, serviceID, planID string) (kubernetes.Client, error) {
	var err error
	cfg := f.cfg
	if cfg == nil {
		cfg, err = config.GetConfig()
		if err != nil {
			log.Error(err, "GetCluster: unable to get client config")
			return nil, errors.NewClusterFactoryError("error getting config object", err)
		}
	}

	options := kubernetes.Options{
		Scheme: f.mgr.GetScheme(),
		Mapper: f.mgr.GetRESTMapper(),
	}
	client, err := kubernetes.New(cfg, options)
	if err != nil {
		log.Error(err, "GetCluster: unable to create kubernetes client")
		return nil, errors.NewClusterFactoryError("error creating new kubernetes client", err)
	}
	return client, nil
}
