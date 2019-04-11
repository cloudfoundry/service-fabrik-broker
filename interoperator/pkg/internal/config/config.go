package config

import (
	"context"
	"os"
	"reflect"
	"strconv"
	"strings"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"gopkg.in/yaml.v2"
	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
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
	configMapNamespace := os.Getenv(constants.NamespaceEnvKey)
	if configMapNamespace == "" {
		configMapNamespace = constants.DefaultServiceFabrikNamespace
	}

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
	log.Info("Successfully fetched configmap", "name", cfg.configMap.Name,
		"namespace", cfg.configMap.Namespace, "data", cfg.configMap.Data)
	return nil
}

func (cfg *config) GetConfig() *InteroperatorConfig {
	interoperatorConfig := newInteroperatorConfig()
	err := cfg.fetchConfig()
	if err != nil {
		log.Info("failed to read interoperator config. using defaults.")
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

	val := reflect.ValueOf(interoperatorConfig)
	configType := reflect.Indirect(val).Type()
	for i := 0; i < configType.NumField(); i++ {
		field := configType.Field(i)
		tags := strings.Split(field.Tag.Get("yaml"), ",")
		if len(tags) == 0 {
			continue
		}
		key := tags[0]
		f := reflect.Indirect(val).FieldByName(field.Name)
		cfg.configMap.Data[key] = encodeField(f.Interface())
	}

	if toCreate {
		err = cfg.c.Create(context.TODO(), cfg.configMap)
	} else {
		err = cfg.c.Update(context.TODO(), cfg.configMap)
	}
	if err != nil {
		return err
	}
	if toCreate {
		log.Info("created interoperator config map", "data", cfg.configMap.Data)
	} else {
		log.Info("updated interoperator config map", "data", cfg.configMap.Data)
	}
	return nil
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

func encodeField(i interface{}) string {
	v := reflect.ValueOf(i)
	switch v.Kind() {
	case reflect.Int:
		return strconv.FormatInt(v.Int(), 10)
	case reflect.String:
		return v.String()
	case reflect.Bool:
		return strconv.FormatBool(v.Bool())
	case reflect.Slice, reflect.Struct, reflect.Map:
		out, _ := yaml.Marshal(i)
		return strings.TrimSpace(string(out))
	}
	return ""
}
