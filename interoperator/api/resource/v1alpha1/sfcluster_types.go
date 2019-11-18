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
)

// SFClusterSpec defines the desired state of SFCluster
type SFClusterSpec struct {
	// Name of the secret containing the kubeconfig required to access the
	// member cluster. The secret needs to exist in the same namespace
	// as the SFCluster and should have a "kubeconfig" key.
	SecretRef string `json:"secretRef"`
}

// SFClusterStatus defines the observed state of SFCluster
type SFClusterStatus struct {
}

// +kubebuilder:object:root=true

// SFCluster is the Schema for the sfclusters API
type SFCluster struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   SFClusterSpec   `json:"spec,omitempty"`
	Status SFClusterStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// SFClusterList contains a list of SFCluster
type SFClusterList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []SFCluster `json:"items"`
}

func init() {
	SchemeBuilder.Register(&SFCluster{}, &SFClusterList{})
}
