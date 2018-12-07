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

// SfServiceBindingSpec defines the desired state of SfServiceBinding
type SfServiceBindingSpec struct {
	ID                string                `json:"id"`
	InstanceID        string                `json:"instanceId"`
	PlanID            string                `json:"planId"`
	ServiceID         string                `json:"serviceId"`
	AppGUID           string                `json:"appGuid,omitempty"`
	BindResource      *runtime.RawExtension `json:"bindResource,omitempty"`
	RawContext        *runtime.RawExtension `json:"context,omitempty"`
	RawParameters     *runtime.RawExtension `json:"parameters,omitempty"`
	AcceptsIncomplete bool                  `json:"acceptsIncomplete,omitempty"`
}

// SfServiceBindingStatus defines the observed state of SfServiceBinding
type SfServiceBindingStatus struct {
	State    string `yaml:"state" json:"state"`
	Error    string `yaml:"error,omitempty" json:"error,omitempty"`
	Response string `yaml:"response,omitempty" json:"response,omitempty"`
}

// +genclient
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SfServiceBinding is the Schema for the sfservicebindings API
// +k8s:openapi-gen=true
type SfServiceBinding struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   SfServiceBindingSpec   `json:"spec,omitempty"`
	Status SfServiceBindingStatus `json:"status,omitempty"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SfServiceBindingList contains a list of SfServiceBinding
type SfServiceBindingList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []SfServiceBinding `json:"items"`
}

func init() {
	SchemeBuilder.Register(&SfServiceBinding{}, &SfServiceBindingList{})
}
