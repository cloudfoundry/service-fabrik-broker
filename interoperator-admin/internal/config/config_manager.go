package config

import (
	"context"
	"errors"
	"strings"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/constants"
	"gopkg.in/yaml.v1"
	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// ConfigManager fetches the runtime configs from the configmap
type ConfigManager struct {
	c         client.Client
	configMap *corev1.ConfigMap
	namespace string
}

var log = ctrl.Log.WithName("config")

// NewConfigManager returns a new Config using the kubernetes client
func NewConfigManager(kubeConfig *rest.Config) (*ConfigManager, error) {
	if kubeConfig == nil {
		return nil, errors.New("kubeconfig was not provided")
	}
	c, err := client.New(kubeConfig, client.Options{})
	if err != nil {
		return nil, err
	}
	configMapNamespace := constants.InteroperatorNamespace

	return &ConfigManager{
		c:         c,
		namespace: configMapNamespace,
	}, nil
}

func (cfgManager *ConfigManager) fetchConfig() error {
	configMap := &corev1.ConfigMap{}
	var configMapKey = types.NamespacedName{
		Name:      constants.AdminConfigMapName,
		Namespace: cfgManager.namespace,
	}
	err := cfgManager.c.Get(context.TODO(), configMapKey, configMap)
	if err != nil {
		return err
	}
	cfgManager.configMap = configMap
	log.Info("Successfully fetched configmap", "name", cfgManager.configMap.Name,
		"namespace", cfgManager.configMap.Namespace, "data", cfgManager.configMap.Data)
	return nil
}

// GetConfig returns current config from cluster if fetchFromCluster=true is passed
// otherwise returns cached configs
func (cfgManager *ConfigManager) GetConfig(fetchFromCluster bool) *InteroperatorAdminConfig {
	interoperatorAdminConfig := &InteroperatorAdminConfig{}
	if fetchFromCluster {
		err := cfgManager.fetchConfig()
		if err != nil {
			log.Info("failed to read interoperator config. using defaults.")
			return setConfigDefaults(interoperatorAdminConfig)
		}
	}
	err := yaml.Unmarshal([]byte(cfgManager.configMap.Data[constants.AdminConfigMapKey]), interoperatorAdminConfig)
	if err != nil {
		log.Info("failed to decode interoperator config. using defaults.")
		return setConfigDefaults(interoperatorAdminConfig)
	}
	return setConfigDefaults(interoperatorAdminConfig)
}

// UpdateConfig updates cluster configmap from given InteroperatorAdminConfig
func (cfgManager *ConfigManager) UpdateConfig(interoperatorAdminConfig *InteroperatorAdminConfig) error {
	if interoperatorAdminConfig == nil {
		return errors.New("interoperator admin config was not provided")
	}
	err := cfgManager.fetchConfig()
	if err != nil {
		log.Error(err, "failed to fetch interoperator config for update")
		return err
	}

	toCreate := false
	if apiErrors.IsNotFound(err) {
		toCreate = true
		cfgManager.configMap = &corev1.ConfigMap{}
		cfgManager.configMap.SetName(constants.AdminConfigMapName)
		cfgManager.configMap.SetNamespace(cfgManager.namespace)
		cfgManager.configMap.Data = make(map[string]string)
	}

	out, err := yaml.Marshal(interoperatorAdminConfig)
	if err != nil {
		return err
	}

	cfgManager.configMap.Data[constants.AdminConfigMapKey] = strings.TrimSpace(string(out))

	if toCreate {
		err = cfgManager.c.Create(context.TODO(), cfgManager.configMap)
	} else {
		err = cfgManager.c.Update(context.TODO(), cfgManager.configMap)
	}
	if err != nil {
		return err
	}
	if toCreate {
		log.Info("created interoperator admin config map")
	} else {
		log.Info("updated interoperator admin config map")
	}
	log.Info("interoperator config", "data", cfgManager.configMap.Data)
	return nil
}
