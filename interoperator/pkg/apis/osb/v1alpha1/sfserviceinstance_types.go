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

// SfServiceInstanceSpec defines the desired state of SfServiceInstance
type SfServiceInstanceSpec struct {
	ServiceID        string                `json:"serviceId"`
	PlanID           string                `json:"planId"`
	RawContext       *runtime.RawExtension `json:"context,omitempty"`
	OrganizationGUID string                `json:"organizationGuid,omitempty"`
	SpaceGUID        string                `json:"spaceGuid,omitempty"`
	RawParameters    *runtime.RawExtension `json:"parameters,omitempty"`
}

// SfServiceInstanceStatus defines the observed state of SfServiceInstance
type SfServiceInstanceStatus struct {
	DashboardURL string `yaml:"dashboardUrl,omitempty" json:"dashboardUrl,omitempty"`
	State        string `yaml:"state" json:"state"`
	Error        string `yaml:"error,omitempty" json:"error,omitempty"`
	Description  string `yaml:"description,omitempty" json:"description,omitempty"`
}

// +genclient
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SfServiceInstance is the Schema for the sfserviceinstances API
// +k8s:openapi-gen=true
type SfServiceInstance struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   SfServiceInstanceSpec   `json:"spec,omitempty"`
	Status SfServiceInstanceStatus `json:"status,omitempty"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SfServiceInstanceList contains a list of SfServiceInstance
type SfServiceInstanceList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []SfServiceInstance `json:"items"`
}

func init() {
	SchemeBuilder.Register(&SfServiceInstance{}, &SfServiceInstanceList{})
}
