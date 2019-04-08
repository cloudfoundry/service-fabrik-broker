package config

import (
	"os"
	"reflect"
	"strconv"
	"strings"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"gopkg.in/yaml.v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var log = logf.Log.WithName("config.manager")

// InteroperatorConfig contains tuneable configs used by interoperator
type InteroperatorConfig struct {
	InstanceWorkerCount int `yaml:"instanceWorkerCount,omitempty"`
	BindingWorkerCount  int `yaml:"bindingWorkerCount,omitempty"`

	InstanceContollerWatchList []osbv1alpha1.APIVersionKind `yaml:"instanceContollerWatchList,omitempty"`
	BindingContollerWatchList  []osbv1alpha1.APIVersionKind `yaml:"bindingContollerWatchList,omitempty"`
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
		return nil, errors.NewInputError("New config", "kubeConfig", nil)
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
		decodeField(f, fieldVal)
	}
	return interoperatorConfig
}

func decodeField(f reflect.Value, fieldVal string) {
	switch f.Kind() {
	case reflect.Int:
		intVal, err := strconv.Atoi(fieldVal)
		if err != nil {
			log.Error(err, "invalid config value, skipping", "value", fieldVal)
			return
		}
		if f.CanSet() {
			f.SetInt(int64(intVal))
		}
	case reflect.Slice:
		switch f.Type().Elem() {
		case reflect.TypeOf(osbv1alpha1.APIVersionKind{}):
			var watchList []osbv1alpha1.APIVersionKind
			decodeYamlUnmarshal(f, fieldVal, &watchList)
		}
	}
}

func decodeYamlUnmarshal(f reflect.Value, fieldVal string, out interface{}) {
	yaml.Unmarshal([]byte(fieldVal), out)
	if f.CanSet() {
		v := reflect.ValueOf(out)
		if v.Kind() == reflect.Ptr && !v.IsNil() {
			v = v.Elem()
		}
		f.Set(v)
	}
}
