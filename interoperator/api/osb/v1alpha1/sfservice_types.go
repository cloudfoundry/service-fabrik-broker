/*
Copyright 2019 The Service Fabrik Authors.

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

// DashboardClient contains the data necessary to activate the Dashboard SSO feature for this service
type DashboardClient struct {
	ID          string `json:"id,omitempty"`
	Secret      string `json:"secret,omitempty"`
	RedirectURI string `json:"redirectUri,omitempty"`
}

// SFServiceSpec defines the desired state of SFService
type SFServiceSpec struct {
	Name                 string   `json:"name"`
	ID                   string   `json:"id"`
	Description          string   `json:"description"`
	Tags                 []string `json:"tags,omitempty"`
	Requires             []string `json:"requires,omitempty"`
	Bindable             bool     `json:"bindable"`
	InstancesRetrievable bool     `json:"instancesRetrievable,omitempty"`
	BindingsRetrievable  bool     `json:"bindingsRetrievable,omitempty"`
	AllowContextUpdates  bool     `json:"allowContextUpdates,omitempty"`

	// +kubebuilder:pruning:PreserveUnknownFields
	Metadata        *runtime.RawExtension `json:"metadata,omitempty"`
	DashboardClient *DashboardClient      `json:"dashboardClient,omitempty"`
	PlanUpdatable   bool                  `json:"planUpdatable,omitempty"`

	// +kubebuilder:pruning:PreserveUnknownFields
	RawContext *runtime.RawExtension `json:"context,omitempty"`
}

// SFServiceStatus defines the observed state of SFService
type SFServiceStatus struct {
	// INSERT ADDITIONAL STATUS FIELD - define observed state of cluster
	// Important: Run "make" to regenerate code after modifying this file
}

// +kubebuilder:object:root=true
// +genclient
// +genclient:noStatus
// +kubebuilder:printcolumn:name="display-name",type=string,JSONPath=`.spec.name`
// +kubebuilder:printcolumn:name="age",type=date,JSONPath=`.metadata.creationTimestamp`

// SFService is the Schema for the sfservices API
type SFService struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   SFServiceSpec   `json:"spec,omitempty"`
	Status SFServiceStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// SFServiceList contains a list of SFService
type SFServiceList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []SFService `json:"items"`
}

func init() {
	SchemeBuilder.Register(&SFService{}, &SFServiceList{})
}
