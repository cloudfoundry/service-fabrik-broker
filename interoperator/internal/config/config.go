package config

import (
	"context"
	"strings"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/yaml"
)

var log = logf.Log.WithName("config.manager")

// InteroperatorConfig contains tuneable configs used by interoperator
type InteroperatorConfig struct {
	InstanceWorkerCount    int    `yaml:"instanceWorkerCount,omitempty"`
	BindingWorkerCount     int    `yaml:"bindingWorkerCount,omitempty"`
	SchedulerWorkerCount   int    `yaml:"schedulerWorkerCount,omitempty"`
	ProvisionerWorkerCount int    `yaml:"provisionerWorkerCount,omitempty"`
	PrimaryClusterID       string `yaml:"primaryClusterId,omitempty"`

	InstanceContollerWatchList []osbv1alpha1.APIVersionKind `yaml:"instanceContollerWatchList,omitempty"`
	BindingContollerWatchList  []osbv1alpha1.APIVersionKind `yaml:"bindingContollerWatchList,omitempty"`
}

// setConfigDefaults assigns default values to config
func setConfigDefaults(interoperatorConfig *InteroperatorConfig) *InteroperatorConfig {
	if interoperatorConfig.BindingWorkerCount == 0 {
		interoperatorConfig.BindingWorkerCount = constants.DefaultBindingWorkerCount
	}
	if interoperatorConfig.InstanceWorkerCount == 0 {
		interoperatorConfig.InstanceWorkerCount = constants.DefaultInstanceWorkerCount
	}
	if interoperatorConfig.SchedulerWorkerCount == 0 {
		interoperatorConfig.SchedulerWorkerCount = constants.DefaultSchedulerWorkerCount
	}
	if interoperatorConfig.ProvisionerWorkerCount == 0 {
		interoperatorConfig.ProvisionerWorkerCount = constants.DefaultProvisionerWorkerCount
	}
	if interoperatorConfig.PrimaryClusterID == "" {
		interoperatorConfig.PrimaryClusterID = constants.DefaultPrimaryClusterID
	}

	return interoperatorConfig
}

// Config fetches the runtime configs from the configmap
type Config interface {
	GetConfig() *InteroperatorConfig
	UpdateConfig(*InteroperatorConfig) error
}

type config struct {
	c         client.Client
	configMap *corev1.ConfigMap
	namespace string
}

// New returns a new Config using the kubernetes client
func New(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) (Config, error) {
	if kubeConfig == nil {
		return nil, errors.NewInputError("New config", "kubeConfig", nil)
	}

	if scheme == nil {
		return nil, errors.NewInputError("New config", "scheme", nil)
	}

	c, err := client.New(kubeConfig, client.Options{
		Scheme: scheme,
		Mapper: mapper,
	})
	if err != nil {
		return nil, err
	}
	configMapNamespace := constants.InteroperatorNamespace

	return &config{
		c:         c,
		namespace: configMapNamespace,
	}, nil
}

func (cfg *config) fetchConfig() error {
	configMap := &corev1.ConfigMap{}
	var configMapKey = types.NamespacedName{
		Name:      constants.ConfigMapName,
		Namespace: cfg.namespace,
	}
	err := cfg.c.Get(context.TODO(), configMapKey, configMap)
	if err != nil {
		return err
	}
	cfg.configMap = configMap
	log.V(2).Info("Successfully fetched configmap", "name", cfg.configMap.Name,
		"namespace", cfg.configMap.Namespace, "data", cfg.configMap.Data)
	return nil
}

func (cfg *config) GetConfig() *InteroperatorConfig {
	interoperatorConfig := &InteroperatorConfig{}
	err := cfg.fetchConfig()
	if err != nil {
		log.Error(err, "failed to read interoperator config. using defaults.")
		return setConfigDefaults(interoperatorConfig)
	}
	err = yaml.Unmarshal([]byte(cfg.configMap.Data[constants.ConfigMapKey]), interoperatorConfig)
	if err != nil {
		log.Error(err, "failed to decode interoperator config. using defaults.")
		return setConfigDefaults(interoperatorConfig)
	}
	return setConfigDefaults(interoperatorConfig)
}

func (cfg *config) UpdateConfig(interoperatorConfig *InteroperatorConfig) error {
	if interoperatorConfig == nil {
		return errors.NewInputError("UpdateConfig", "interoperatorConfig", nil)
	}
	err := cfg.fetchConfig()
	if err != nil && !apiErrors.IsNotFound(err) {
		log.Error(err, "failed to fetch interoperator config for update")
		return err
	}

	toCreate := false
	if apiErrors.IsNotFound(err) {
		toCreate = true
		cfg.configMap = &corev1.ConfigMap{}
		cfg.configMap.SetName(constants.ConfigMapName)
		cfg.configMap.SetNamespace(cfg.namespace)
		cfg.configMap.Data = make(map[string]string)
	}

	out, err := yaml.Marshal(interoperatorConfig)
	if err != nil {
		return errors.NewMarshalError("failed to marshal interoperatorConfig", err)
	}

	cfg.configMap.Data[constants.ConfigMapKey] = strings.TrimSpace(string(out))

	if toCreate {
		err = cfg.c.Create(context.TODO(), cfg.configMap)
	} else {
		err = cfg.c.Update(context.TODO(), cfg.configMap)
	}
	if err != nil {
		return err
	}
	if toCreate {
		log.Info("created interoperator config map")
	} else {
		log.Info("updated interoperator config map")
	}
	log.V(2).Info("interoperator config", "data", cfg.configMap.Data)
	return nil
}
