package registry

import (
	"context"

	resourceV1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	ctrl "sigs.k8s.io/controller-runtime"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
)

var log = logf.Log.WithName("cluster.registry")

// ClusterRegistry keep track of clusters and gets client for them
//
//go:generate mockgen -source registry.go -destination ./mock_registry/mock_registry.go
type ClusterRegistry interface {
	GetClient(clusterID string) (kubernetes.Client, error)
	GetCluster(clusterID string) (resourceV1alpha1.SFClusterInterface, error)
	ListClusters(options *kubernetes.ListOptions) (*resourceV1alpha1.SFClusterList, error)
}

type clusterRegistry struct {
	scheme     *runtime.Scheme
	mapper     meta.RESTMapper
	kubeConfig *rest.Config
	c          kubernetes.Client
	namespace  string
}

// New returns a new ClusterRegistry using the provided manager
func New(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) (ClusterRegistry, error) {
	if kubeConfig == nil {
		return nil, errors.NewInputError("New ClusterRegistry", "kubeConfig", nil)
	}

	if scheme == nil {
		return nil, errors.NewInputError("New ClusterRegistry", "scheme", nil)
	}

	c, err := kubernetes.New(kubeConfig, kubernetes.Options{
		Scheme: scheme,
		Mapper: mapper,
	})
	if err != nil {
		return nil, err
	}

	sfNamespace := constants.InteroperatorNamespace

	r := &clusterRegistry{
		scheme:     scheme,
		mapper:     mapper,
		kubeConfig: kubeConfig,
		c:          c,
		namespace:  sfNamespace,
	}
	return r, nil
}

func (r *clusterRegistry) createClient(cfg *rest.Config) (kubernetes.Client, error) {
	c, err := kubernetes.New(cfg, kubernetes.Options{
		Scheme: r.scheme,
		Mapper: r.mapper,
	})
	if err != nil {
		return nil, err
	}
	return c, nil
}

// GetClient returns a kubernetes client for a cluster
func (r *clusterRegistry) GetClient(clusterID string) (kubernetes.Client, error) {
	cluster, err := r.GetCluster(clusterID)
	if err != nil {
		return nil, err
	}
	var cfg *rest.Config

	cfgManager, err := config.New(r.kubeConfig, r.scheme, r.mapper)
	if err != nil {
		return nil, err
	}
	interoperatorCfg := cfgManager.GetConfig()
	currPrimaryClusterID := interoperatorCfg.PrimaryClusterID

	if clusterID == constants.OwnClusterID || clusterID == currPrimaryClusterID {
		// Use in cluster config
		cfg, err = ctrl.GetConfig()
	} else {
		// Get config from secret
		cfg, err = cluster.GetKubeConfig(r.c)
	}
	if err != nil {
		log.Error(err, "unable to get kubeconfig", "clusterID", clusterID)
		return nil, err
	}

	c, err := r.createClient(cfg)
	if err != nil {
		log.Error(err, "unable to create k8s client", "clusterID", clusterID)
		return nil, err
	}
	return c, nil
}

// GetCluster returns a cluster detail
func (r *clusterRegistry) GetCluster(clusterID string) (resourceV1alpha1.SFClusterInterface, error) {
	cluster := &resourceV1alpha1.SFCluster{}
	var clusterKey = types.NamespacedName{
		Name:      clusterID,
		Namespace: r.namespace,
	}
	err := r.c.Get(context.TODO(), clusterKey, cluster)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			return nil, errors.NewSFClusterNotFound(clusterID, err)
		}
		return nil, err
	}
	return cluster, nil
}

// ListClusters fetches all the clusters with the given options
func (r *clusterRegistry) ListClusters(options *kubernetes.ListOptions) (*resourceV1alpha1.SFClusterList, error) {
	if options == nil {
		options = &kubernetes.ListOptions{
			Namespace: r.namespace,
		}
	}
	options.Namespace = r.namespace
	clusters := &resourceV1alpha1.SFClusterList{}
	err := r.c.List(context.TODO(), clusters, options)
	if err != nil {
		return nil, err
	}
	return clusters, nil
}
