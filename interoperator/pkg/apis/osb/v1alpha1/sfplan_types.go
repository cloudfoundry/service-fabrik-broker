/*
Copyright 2018 The Service Fabrik Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package v1alpha1

import (
	"fmt"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	runtime "k8s.io/apimachinery/pkg/runtime"
)

// List of templates to be provided for a service plan
const (
	ProvisionAction  = "provision"
	PropertiesAction = "properties"
	BindAction       = "bind"
)

// TemplateSpec is the specifcation of a template
// Supported names: provisionTemplate, bindTemplate, propertiesTemplate
type TemplateSpec struct {
	Action string `yaml:"action" json:"action"`
	Type   string `yaml:"type" json:"type"`
	URL    string `yaml:"url" json:"url"`
}

// Schema definition for the input parameters.
type Schema struct {
	Parameters *runtime.RawExtension `json:"parameters"`
}

// ServiceInstanceSchema is the schema definitions for creating
// and updating a Service Instance.
type ServiceInstanceSchema struct {
	Create Schema `json:"create,omitempty"`
	Update Schema `json:"update,omitempty"`
}

// ServiceBindingSchema is the  schema definition for creating a
// Service Binding. Used only if the Service Plan is bindable.
type ServiceBindingSchema struct {
	Create Schema `json:"create,omitempty"`
}

// ServiceSchemas is definitions for Service Instances and
// Service Bindings for the Service Plan.
type ServiceSchemas struct {
	Instance ServiceInstanceSchema `json:"instance,omitempty"`
	Binding  ServiceBindingSchema  `json:"binding,omitempty"`
}

// SfPlanSpec defines the desired state of SfPlan
type SfPlanSpec struct {
	Name          string                `json:"name"`
	ID            string                `json:"id"`
	Description   string                `json:"description"`
	Metadata      *runtime.RawExtension `json:"metadata,omitempty"`
	Free          bool                  `json:"free"`
	Bindable      bool                  `json:"bindable"`
	PlanUpdatable bool                  `json:"planUpdatable,omitempty"`
	Schemas       *ServiceSchemas       `json:"schemas,omitempty"`
	Templates     []TemplateSpec        `json:"templates"`
	ServiceID     string                `json:"serviceId"`
	RawContext    *runtime.RawExtension `json:"context,omitempty"`
	Manager       *runtime.RawExtension `json:"manager,omitempty"`
	// Add supported_platform field
}

// SfPlanStatus defines the observed state of SfPlan
type SfPlanStatus struct {
	// INSERT ADDITIONAL STATUS FIELD - define observed state of cluster
	// Important: Run "make" to regenerate code after modifying this file
}

// +genclient
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SfPlan is the Schema for the sfplans API
// +k8s:openapi-gen=true
type SfPlan struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   SfPlanSpec   `json:"spec,omitempty"`
	Status SfPlanStatus `json:"status,omitempty"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SfPlanList contains a list of SfPlan
type SfPlanList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []SfPlan `json:"items"`
}

func init() {
	SchemeBuilder.Register(&SfPlan{}, &SfPlanList{})
}

// GetTemplate fetches the Template spec with the given action
func (sfPlan *SfPlan) GetTemplate(action string) (*TemplateSpec, error) {
	for _, template := range sfPlan.Spec.Templates {
		if template.Action == action {
			return &template, nil
		}
	}
	return nil, fmt.Errorf("failed to get template %s", action)
}
