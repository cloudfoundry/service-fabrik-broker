package config

import (
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/constants"
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
