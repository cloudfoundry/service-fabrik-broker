package config

import (
	"os"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/constants"
)

// InteroperatorAdminConfig contains configs used by interoperator admin app
type InteroperatorAdminConfig struct {
	ServerPort string
	Username   string
	Password   string
}

// NewAdminConfig returns ConfigManager
func NewAdminConfig() *InteroperatorAdminConfig {
	adminConfig := &InteroperatorAdminConfig{}
	adminConfig = setConfigDefaults(adminConfig)
	return adminConfig
}

// setConfigDefaults assigns default values to config
func setConfigDefaults(interoperatorAdminConfig *InteroperatorAdminConfig) *InteroperatorAdminConfig {
	if interoperatorAdminConfig.ServerPort == "" {
		interoperatorAdminConfig.ServerPort = constants.DefaultPort
	}
	if interoperatorAdminConfig.Username == "" {
		interoperatorAdminConfig.Username = constants.DefaultUsername
	}
	if interoperatorAdminConfig.Password == "" {
		interoperatorAdminConfig.Password = constants.DefaultPassword
	}
	return interoperatorAdminConfig
}

// InitConfig returns configuration value for the key from the environment
// If the key is not present in environment it throws error.
func (config *InteroperatorAdminConfig) InitConfig() {
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
