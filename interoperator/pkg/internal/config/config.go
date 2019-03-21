package config

import (
	"fmt"
	"os"
	"reflect"
	"strconv"
	"strings"

	"k8s.io/client-go/rest"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var log = logf.Log.WithName("config.manager")

// InteroperatorConfig contains tuneable configs used by interoperator
type InteroperatorConfig struct {
	InstanceWorkerCount int `yaml:"instanceWorkerCount,omitempty"`
	BindingWorkerCount  int `yaml:"bindingWorkerCount,omitempty"`
}

// newInteroperatorConfig assigns default values to config
func newInteroperatorConfig() *InteroperatorConfig {
	return &InteroperatorConfig{
		BindingWorkerCount:  constants.DefaultBindingWorkerCount,
		InstanceWorkerCount: constants.DefaultInstanceWorkerCount,
	}
}

// Config fetches the runtime configs from the configmap
type Config interface {
	GetConfig() *InteroperatorConfig
}

type config struct {
	kubeConfig *rest.Config
	clientset  *kubernetes.Clientset
	configMap  *corev1.ConfigMap
}

// New returns a new Config using the kubernetes client
func New(kubeConfig *rest.Config) (Config, error) {
	if kubeConfig == nil {
		return nil, fmt.Errorf("invalid input to new config")
	}
	// create the clientset
	clientset, err := kubernetes.NewForConfig(kubeConfig)
	if err != nil {
		return nil, err
	}
	return &config{
		kubeConfig: kubeConfig,
		clientset:  clientset,
	}, nil
}

func (cfg *config) fetchConfig() error {
	var err error
	configMapNamespace := os.Getenv(constants.NamespaceEnvKey)
	if configMapNamespace == "" {
		configMapNamespace = constants.DefaultServiceFabrikNamespace
	}
	cfg.configMap, err = cfg.clientset.CoreV1().
		ConfigMaps(configMapNamespace).
		Get(constants.ConfigMapName, metav1.GetOptions{})
	if err != nil {
		return err
	}
	log.Info("Successfully fetched configmap", "name", cfg.configMap.Name,
		"namespace", cfg.configMap.Namespace, "data", cfg.configMap.Data)
	return nil
}

func (cfg *config) GetConfig() *InteroperatorConfig {
	interoperatorConfig := newInteroperatorConfig()
	err := cfg.fetchConfig()
	if err != nil {
		log.Error(err, "failed to update interoperator config. using defaults.")
		return interoperatorConfig
	}
	val := reflect.ValueOf(interoperatorConfig)
	configType := reflect.Indirect(val).Type()
	for i := 0; i < configType.NumField(); i++ {
		field := configType.Field(i)
		tags := strings.Split(field.Tag.Get("yaml"), ",")
		if len(tags) == 0 {
			continue
		}
		key := tags[0]
		fieldVal, ok := cfg.configMap.Data[key]
		if !ok {
			continue
		}
		f := reflect.Indirect(val).FieldByName(field.Name)
		if f.Kind() == reflect.Int {
			intVal, err := strconv.Atoi(fieldVal)
			if err != nil {
				log.Error(err, "invalid config value, skipping", "field", key, "value", fieldVal)
				continue
			}
			if f.CanSet() {
				f.SetInt(int64(intVal))
			}
		}
	}
	return interoperatorConfig
}
