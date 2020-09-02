package provisioner

import (
	"context"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	appsv1 "k8s.io/api/apps/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
)

var log = logf.Log.WithName("provisioner.internal")

// Provisioner fetches provisioner stateful set
//go:generate mockgen -source provisioner.go -destination ./mock_provisioner/mock_provisioner.go
type Provisioner interface {
	Fetch() error
	Get() (*appsv1.Deployment, error)
}

type provisioner struct {
	c          client.Client
	deployment *appsv1.Deployment
	namespace  string
}

// New returns stateful using kubernetes client
func New(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) (Provisioner, error) {
	if kubeConfig == nil {
		return nil, errors.NewInputError("New provisioner", "kubeConfig", nil)
	}

	if scheme == nil {
		return nil, errors.NewInputError("New provisioner", "scheme", nil)
	}

	c, err := client.New(kubeConfig, client.Options{
		Scheme: scheme,
		Mapper: mapper,
	})
	if err != nil {
		return nil, err
	}
	provisionerNamespace := constants.InteroperatorNamespace

	return &provisioner{
		c:         c,
		namespace: provisionerNamespace,
	}, nil
}

func (p *provisioner) Fetch() error {
	deployment := &appsv1.Deployment{}
	var deploymentKey = types.NamespacedName{
		Name:      constants.ProvisionerName,
		Namespace: p.namespace,
	}
	err := p.c.Get(context.TODO(), deploymentKey, deployment)
	if err != nil {
		return err
	}
	log.Info("Successfully fetched deployment", "name ", deployment.Name,
		"namespace", deployment.Namespace)
	p.deployment = deployment
	return nil
}

func (p *provisioner) Get() (*appsv1.Deployment, error) {
	err := p.Fetch()
	if err != nil {
		return nil, err
	}
	return p.deployment, nil
}
