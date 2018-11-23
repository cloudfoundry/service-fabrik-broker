package services

import (
	"fmt"
	"io/ioutil"
	"path/filepath"

	"gopkg.in/yaml.v2"
)

const servicesPath = "config/samples/services"

// Info is the details for a particular service
type Info struct {
	ID                 string       `yaml:"id" json:"id"`
	Name               string       `yaml:"name,omitempty" json:"name,omitempty"`
	Template           TemplateSpec `yaml:"template" json:"template"`
	PropertiesTemplate TemplateSpec `yaml:"propertiesTemplate" json:"propertiesTemplate"`
}

// TemplateSpec is the template specifcation of a service
type TemplateSpec struct {
	Type string `yaml:"type" json:"type"`
	Path string `yaml:"path" json:"path"`
}

// FindServiceInfo fetches the details of a service
// from the services path
func FindServiceInfo(serviceID string) (*Info, error) {
	topDir, err := filepath.Abs(servicesPath)
	if err != nil {
		return nil, err
	}
	services, err := ioutil.ReadDir(topDir)
	if err != nil {
		return nil, fmt.Errorf("unable to read services directory %v", err)
	}

	for _, s := range services {
		if !s.IsDir() {
			continue
		}
		service, err := getServiceInfo(filepath.Join(topDir, s.Name()))
		if err != nil {
			continue
		}
		if service.ID == serviceID {
			return service, nil
		}
	}
	return nil, fmt.Errorf("unable to find service with id %s", serviceID)
}

func getServiceInfo(folderPath string) (*Info, error) {
	base := filepath.Base(folderPath)
	file := folderPath + string(filepath.Separator) + "Service.yaml"
	buf, err := ioutil.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("unable to read Services.yaml for %s. %v", base, err)
	}
	service := Info{}

	err = yaml.Unmarshal(buf, &service)
	if err != nil {
		return nil, fmt.Errorf("unable to parse Services.yaml for %s. %v", base, err)
	}
	return &service, nil
}
