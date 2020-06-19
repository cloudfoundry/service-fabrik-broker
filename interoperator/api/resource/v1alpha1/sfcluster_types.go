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
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// SFClusterSpec defines the desired state of SFCluster
type SFClusterSpec struct {
	// Name of the secret containing the kubeconfig required to access the
	// member cluster. The secret needs to exist in the same namespace
	// as the SFCluster and should have a "kubeconfig" key.
	SecretRef string `yaml:"secretRef" json:"secretRef"`

	// TotalCapacity represents the total resources of a cluster.
	// This should include the future capacity introduced by node autoscaler.
	TotalCapacity corev1.ResourceList `yaml:"totalCapacity,omitempty" json:"totalCapacity,omitempty"`

	// +kubebuilder:validation:Minimum=0
	// +kubebuilder:validation:Maximum=100
	// Determines the how filled the cluster becomes, before interoperator filters out the cluster as full.
	SchedulingLimitPercentage int `yaml:"schedulingLimitPercentage,omitempty" json:"schedulingLimitPercentage,omitempty"`
}

// SFClusterStatus defines the observed state of SFCluster
type SFClusterStatus struct {
	ServiceInstanceCount int `json:"serviceInstanceCount,omitempty"`

	// CurrentCapacity represents the total resources of a cluster from all the current nodes
	CurrentCapacity corev1.ResourceList `yaml:"currentCapacity,omitempty" json:"currentCapacity,omitempty"`

	// TotalCapacity represents the total resources of a cluster.
	// This should include the future capacity introduced by node autoscaler.
	TotalCapacity corev1.ResourceList `yaml:"totalCapacity,omitempty" json:"totalCapacity,omitempty"`

	// Requests represents the total resources requested by all the pods on the cluster
	Requests corev1.ResourceList `yaml:"requests,omitempty" json:"requests,omitempty"`
}

// +kubebuilder:object:root=true
// +genclient

// SFCluster is the Schema for the sfclusters API
// +kubebuilder:subresource:status
// +kubebuilder:printcolumn:name="numserviceinstance",type=integer,JSONPath=`.status.serviceInstanceCount`
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
