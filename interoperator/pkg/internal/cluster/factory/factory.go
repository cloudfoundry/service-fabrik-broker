package factory

import (
	"fmt"
	"log"

	"k8s.io/client-go/rest"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/config"
	"sigs.k8s.io/controller-runtime/pkg/manager"
)

// ClusterFactory sets up k8s clusters and gets client for them
//go:generate mockgen -source factory.go -destination ./mock_factory/mock_factory.go
type ClusterFactory interface {
	GetCluster(instanceID, bindingID, serviceID, planID string) (kubernetes.Client, error)
}

type clusterFactory struct {
	mgr manager.Manager
	cfg *rest.Config
}

// New returns a new ClusterFactory using the provided manager
func New(mgr manager.Manager) (ClusterFactory, error) {
	if mgr == nil {
		return nil, fmt.Errorf("invalid input to new manager")
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
			log.Printf("unable to get client config %v", err)
			return nil, err
		}
	}

	options := kubernetes.Options{
		Scheme: f.mgr.GetScheme(),
		Mapper: f.mgr.GetRESTMapper(),
	}
	client, err := kubernetes.New(cfg, options)
	if err != nil {
		log.Printf("unable create kubernetes client %v", err)
		return nil, err
	}
	return client, nil
}
