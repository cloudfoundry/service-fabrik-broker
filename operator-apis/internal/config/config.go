package config

import (
	"os"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/constants"
	"k8s.io/client-go/rest"
)

// OperatorApisConfig contains configs used by interoperator operator apis app
type OperatorApisConfig struct {
	ServerPort string
	Username   string
	Password   string
	Kubeconfig *rest.Config
}

// NewOperatorApisConfig returns OperatorApisConfig instance
func NewOperatorApisConfig(kubeconfig *rest.Config) *OperatorApisConfig {
	operatorApisConfig := &OperatorApisConfig{}
	setConfigDefaults(operatorApisConfig)
	operatorApisConfig.Kubeconfig = kubeconfig
	return operatorApisConfig
}

// setConfigDefaults assigns default values to config
func setConfigDefaults(OperatorApisConfig *OperatorApisConfig) {
	if OperatorApisConfig.ServerPort == "" {
		OperatorApisConfig.ServerPort = constants.DefaultPort
	}
	if OperatorApisConfig.Username == "" {
		OperatorApisConfig.Username = constants.DefaultUsername
	}
	if OperatorApisConfig.Password == "" {
		OperatorApisConfig.Password = constants.DefaultPassword
	}
}

// InitConfig returns configuration values from the environment
func (config *OperatorApisConfig) InitConfig() {
	if val, ok := os.LookupEnv(constants.PortConfigKey); ok {
		config.ServerPort = val
	}
	if val, ok := os.LookupEnv(constants.UsernameConfigKey); ok {
		config.Username = val
	}
	if val, ok := os.LookupEnv(constants.PasswordConfigKey); ok {
		config.Password = val
	}
}
