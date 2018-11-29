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
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	runtime "k8s.io/apimachinery/pkg/runtime"
)

// TemplateSpec is the specifcation of a template
// Supported names: provisionTemplate, bindTemplate, propertiesTemplate
type TemplateSpec struct {
	Name string `yaml:"name" json:"name"`
	Type string `yaml:"type" json:"type"`
	Path string `yaml:"path" json:"path"`
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

// PlanSpec defines the desired state of Plan
type PlanSpec struct {
	Name          string                `json:"name"`
	ID            string                `json:"id"`
	Description   string                `json:"description"`
	Metadata      *runtime.RawExtension `json:"metadata,omitempty"`
	Free          bool                  `json:"free"`
	Bindable      bool                  `json:"bindable"`
	PlanUpdatable bool                  `json:"planUpdatable,omitempty"`
	Schemas       *ServiceSchemas       `json:"schemas,omitempty"`
	Templates     []TemplateSpec        `json:"templates"`
	RawContext    *runtime.RawExtension `json:"context,omitempty"`
	ServiceID     string                `json:"serviceId"`
}

// PlanStatus defines the observed state of Plan
type PlanStatus struct {
	// INSERT ADDITIONAL STATUS FIELD - define observed state of cluster
	// Important: Run "make" to regenerate code after modifying this file
}

// +genclient
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// Plan is the Schema for the plans API
// +k8s:openapi-gen=true
type Plan struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   PlanSpec   `json:"spec,omitempty"`
	Status PlanStatus `json:"status,omitempty"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// PlanList contains a list of Plan
type PlanList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []Plan `json:"items"`
}

func init() {
	SchemeBuilder.Register(&Plan{}, &PlanList{})
}
