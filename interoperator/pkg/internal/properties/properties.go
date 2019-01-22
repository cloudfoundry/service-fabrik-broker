package properties

import (
	"fmt"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"

	yaml "gopkg.in/yaml.v2"
)

// GenericStatus defines template provided by the service for binding response
type GenericStatus struct {
	State    string `yaml:"state" json:"state"`
	Error    string `yaml:"error,omitempty" json:"error,omitempty"`
	Response string `yaml:"response,omitempty" json:"response,omitempty"`
}

// InstanceStatus defines template provided by the service for provision response
type InstanceStatus struct {
	State        string `yaml:"state" json:"state"`
	Error        string `yaml:"error,omitempty" json:"error,omitempty"`
	Response     string `yaml:"response,omitempty" json:"response,omitempty"`
	DashboardURL string `yaml:"dashboardUrl,omitempty" json:"dashboardUrl,omitempty"`
}

// Status is all the data to be read by interoperator from
// services. status template is unmarshalled to this struct
type Status struct {
	Provision   InstanceStatus `yaml:"provision" json:"provision"`
	Bind        GenericStatus  `yaml:"bind" json:"bind"`
	Unbind      GenericStatus  `yaml:"unbind" json:"unbind"`
	Deprovision GenericStatus  `yaml:"deprovision" json:"deprovision"`
}

// ParseSources decodes sources yaml into a map
func ParseSources(sourcesString string) (map[string]osbv1alpha1.Source, error) {
	sources := make(map[string]osbv1alpha1.Source)
	err := yaml.Unmarshal([]byte(sourcesString), &sources)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal %s. %v", sourcesString, err)
	}
	return sources, nil
}

// ParseStatus decodes status template into a Status struct
func ParseStatus(propertiesString string) (*Status, error) {
	status := &Status{}
	err := yaml.Unmarshal([]byte(propertiesString), status)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal %s. %v", propertiesString, err)
	}
	return status, nil
}
