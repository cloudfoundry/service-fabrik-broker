package properties

import (
	"fmt"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"

	yaml "gopkg.in/yaml.v2"
)

// Source is the details for identifying each resource
// sources.yaml file is unmarshalled to a map[string]Source
type Source struct {
	APIVersion string `yaml:"apiVersion" json:"apiVersion"`
	Kind       string `yaml:"kind" json:"kind"`
	Name       string `yaml:"name" json:"name"`
	Namespace  string `yaml:"namespace" json:"namespace"`
}

// Properties is all the data to be read by interoperator from
// services. properties.yaml file is unmarshalled to this struct
type Properties struct {
	Status osbv1alpha1.ServiceInstanceStatus `yaml:"status" json:"status"`
}

// ParseSources decodes sources yaml into a map
func ParseSources(sourcesString string) (map[string]Source, error) {
	sources := make(map[string]Source)
	err := yaml.Unmarshal([]byte(sourcesString), &sources)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal %s. %v", sourcesString, err)
	}
	return sources, nil
}

// ParseProperties decodes properties yaml into a Proberties struct
func ParseProperties(propertiesString string) (*Properties, error) {
	properties := &Properties{}
	err := yaml.Unmarshal([]byte(propertiesString), properties)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal %s. %v", propertiesString, err)
	}
	return properties, nil
}
