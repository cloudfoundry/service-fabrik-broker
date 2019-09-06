package provisioner

import (
	"context"
	"os"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var log = logf.Log.WithName("provisioner.internal")

// Provisioner fetches provisioner stateful set
//go:generate mockgen -source provisioner.go -destination ./mock_provisioner/mock_provisioner.go
type Provisioner interface {
	FetchStatefulset() error
	GetStatefulSet() (*appsv1.StatefulSet, error)
}

type provisioner struct {
	c           client.Client
	statefulSet *appsv1.StatefulSet
	namespace   string
}

// New returns stateful using kubernetes client
func New(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) (Provisioner, error) {
	if kubeConfig == nil {
		return nil, errors.NewInputError("New statefulset", "kubeConfig", nil)
	}

	if scheme == nil {
		return nil, errors.NewInputError("New statefulset", "scheme", nil)
	}

	c, err := client.New(kubeConfig, client.Options{
		Scheme: scheme,
		Mapper: mapper,
	})
	if err != nil {
		return nil, err
	}
	statefulsetNamespace := os.Getenv(constants.NamespaceEnvKey)
	if statefulsetNamespace == "" {
		statefulsetNamespace = constants.DefaultServiceFabrikNamespace
	}

	return &provisioner{
		c:         c,
		namespace: statefulsetNamespace,
	}, nil
}

func (sfs *provisioner) FetchStatefulset() error {
	sfset := &appsv1.StatefulSet{}
	var sfsKey = types.NamespacedName{
		Name:      constants.StatefulSetName,
		Namespace: sfs.namespace,
	}
	err := sfs.c.Get(context.TODO(), sfsKey, sfset)
	if err != nil {
		return err
	}
	log.Info("Successfully fetched statefulset", "name ", sfset.Name,
		"namespace", sfset.Namespace)
	sfs.statefulSet = sfset
	return nil
}

func (sfs *provisioner) GetStatefulSet() (*appsv1.StatefulSet, error) {
	if sfs.statefulSet == nil {
		err := sfs.FetchStatefulset()
		if err != nil {
			return nil, err
		}
	}
	return sfs.statefulSet, nil
}
