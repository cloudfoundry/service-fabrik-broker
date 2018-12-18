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

// Source is the details for identifying each resource
// sources.yaml file is unmarshalled to a map[string]Source
type Source struct {
	APIVersion string `yaml:"apiVersion" json:"apiVersion"`
	Kind       string `yaml:"kind" json:"kind"`
	Name       string `yaml:"name" json:"name"`
	Namespace  string `yaml:"namespace" json:"namespace"`
}

func (r Source) String() string {
	return fmt.Sprintf("%s/%s (%s %s)", r.Namespace, r.Name, r.Kind, r.APIVersion)
}

// SFServiceInstanceSpec defines the desired state of SFServiceInstance
type SFServiceInstanceSpec struct {
	ServiceID        string                `json:"serviceId"`
	PlanID           string                `json:"planId"`
	RawContext       *runtime.RawExtension `json:"context,omitempty"`
	OrganizationGUID string                `json:"organizationGuid,omitempty"`
	SpaceGUID        string                `json:"spaceGuid,omitempty"`
	RawParameters    *runtime.RawExtension `json:"parameters,omitempty"`
}

// SFServiceInstanceStatus defines the observed state of SFServiceInstance
type SFServiceInstanceStatus struct {
	DashboardURL string                `yaml:"dashboardUrl,omitempty" json:"dashboardUrl,omitempty"`
	State        string                `yaml:"state" json:"state"`
	Error        string                `yaml:"error,omitempty" json:"error,omitempty"`
	Description  string                `yaml:"description,omitempty" json:"description,omitempty"`
	AppliedSpec  SFServiceInstanceSpec `yaml:"appliedSpec,omitempty" json:"appliedSpec,omitempty"`
	CRDs         []Source              `yaml:"crds,omitempty" json:"crds,omitempty"`
}

// +genclient
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SFServiceInstance is the Schema for the sfserviceinstances API
// +k8s:openapi-gen=true
type SFServiceInstance struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   SFServiceInstanceSpec   `json:"spec,omitempty"`
	Status SFServiceInstanceStatus `json:"status,omitempty"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SFServiceInstanceList contains a list of SFServiceInstance
type SFServiceInstanceList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []SFServiceInstance `json:"items"`
}

func init() {
	SchemeBuilder.Register(&SFServiceInstance{}, &SFServiceInstanceList{})
}
