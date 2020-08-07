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

// InteroperatorAdminConfig contains configs used by interoperator admin app
type InteroperatorAdminConfig struct {
	ServerPort int    `yaml:"serverPort,omitempty"`
	Username   string `yaml:"username,omitempty"`
	Password   string `yaml:"password,omitempty"`
}

// setConfigDefaults assigns default values to config
func setConfigDefaults(interoperatorAdminConfig *InteroperatorAdminConfig) *InteroperatorAdminConfig {
	if interoperatorAdminConfig.ServerPort == 0 {
		interoperatorAdminConfig.ServerPort = constants.ServerDefaultPort
	}
	if interoperatorAdminConfig.Username == "" {
		interoperatorAdminConfig.Username = constants.ServerDefaultUsername
	}
	if interoperatorAdminConfig.Password == "" {
		interoperatorAdminConfig.Password = constants.ServerDefaultPassword
	}
	return interoperatorAdminConfig
}

// Config fetches the runtime configs from the configmap
type Config interface {
	GetConfig() *InteroperatorAdminConfig
	UpdateConfig(*InteroperatorAdminConfig) error
}

type config struct {
	c         client.Client
	configMap *corev1.ConfigMap
	namespace string
}

var log = ctrl.Log.WithName("config")

// New returns a new Config using the kubernetes client
func New(kubeConfig *rest.Config) (Config, error) {
	if kubeConfig == nil {
		return nil, errors.New("kubeconfig was not provided")
	}
	c, err := client.New(kubeConfig, client.Options{})
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
		Name:      constants.AdminConfigMapName,
		Namespace: cfg.namespace,
	}
	err := cfg.c.Get(context.TODO(), configMapKey, configMap)
	if err != nil {
		return err
	}
	cfg.configMap = configMap
	log.Info("Successfully fetched configmap", "name", cfg.configMap.Name,
		"namespace", cfg.configMap.Namespace, "data", cfg.configMap.Data)
	return nil
}

func (cfg *config) GetConfig() *InteroperatorAdminConfig {
	interoperatorAdminConfig := &InteroperatorAdminConfig{}
	err := cfg.fetchConfig()
	if err != nil {
		log.Info("failed to read interoperator config. using defaults.")
		return setConfigDefaults(interoperatorAdminConfig)
	}
	err = yaml.Unmarshal([]byte(cfg.configMap.Data[constants.AdminConfigMapKey]), interoperatorAdminConfig)
	if err != nil {
		log.Info("failed to decode interoperator config. using defaults.")
		return setConfigDefaults(interoperatorAdminConfig)
	}
	return setConfigDefaults(interoperatorAdminConfig)
}

func (cfg *config) UpdateConfig(interoperatorAdminConfig *InteroperatorAdminConfig) error {
	if interoperatorAdminConfig == nil {
		return errors.New("interoperator admin config was not provided")
	}
	err := cfg.fetchConfig()
	if err != nil {
		log.Error(err, "failed to fetch interoperator config for update")
		return err
	}

	toCreate := false
	if apiErrors.IsNotFound(err) {
		toCreate = true
		cfg.configMap = &corev1.ConfigMap{}
		cfg.configMap.SetName(constants.AdminConfigMapName)
		cfg.configMap.SetNamespace(cfg.namespace)
		cfg.configMap.Data = make(map[string]string)
	}

	out, err := yaml.Marshal(interoperatorAdminConfig)
	if err != nil {
		return err
	}

	cfg.configMap.Data[constants.AdminConfigMapKey] = strings.TrimSpace(string(out))

	if toCreate {
		err = cfg.c.Create(context.TODO(), cfg.configMap)
	} else {
		err = cfg.c.Update(context.TODO(), cfg.configMap)
	}
	if err != nil {
		return err
	}
	if toCreate {
		log.Info("created interoperator admin config map")
	} else {
		log.Info("updated interoperator admin config map")
	}
	log.Info("interoperator config", "data", cfg.configMap.Data)
	return nil
}
