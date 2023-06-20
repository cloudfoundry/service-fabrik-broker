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
	"fmt"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	runtime "k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
)

// SFServiceInstanceSpec defines the desired state of SFServiceInstance
type SFServiceInstanceSpec struct {
	InstanceID string `json:"instanceId,omitempty"`
	ServiceID  string `json:"serviceId"`
	PlanID     string `json:"planId"`

	// +kubebuilder:pruning:PreserveUnknownFields
	RawContext       *runtime.RawExtension `json:"context,omitempty"`
	OrganizationGUID string                `json:"organizationGuid,omitempty"`
	SpaceGUID        string                `json:"spaceGuid,omitempty"`

	// +kubebuilder:pruning:PreserveUnknownFields
	RawParameters *runtime.RawExtension `json:"parameters,omitempty"`
	Metadata      *MetadataSpec         `json:"metadata,omitempty"`

	// +kubebuilder:pruning:PreserveUnknownFields
	PreviousValues *runtime.RawExtension `json:"previousValues,omitempty"`
	ClusterID      string                `json:"clusterId,omitempty"`
}

// MetadataSpec defines an optional object containing metadata for the Service Instance.
type MetadataSpec struct {
	Labels     map[string]string `json:"labels,omitempty"`
	Attributes map[string]string `json:"attributes,omitempty"`
}

// SFServiceInstanceStatus defines the observed state of SFServiceInstance
type SFServiceInstanceStatus struct {
	DashboardURL     string                `yaml:"dashboardUrl,omitempty" json:"dashboardUrl,omitempty"`
	State            string                `yaml:"state" json:"state"`
	Error            string                `yaml:"error,omitempty" json:"error,omitempty"`
	Description      string                `yaml:"description,omitempty" json:"description,omitempty"`
	InstanceUsable   string                `yaml:"instanceUsable,omitempty" json:"instanceUsable,omitempty"`
	UpdateRepeatable string                `yaml:"updateRepeatable,omitempty" json:"updateRepeatable,omitempty"`
	AppliedSpec      SFServiceInstanceSpec `yaml:"appliedSpec,omitempty" json:"appliedSpec,omitempty"`
	Resources        []Source              `yaml:"resources,omitempty" json:"resources,omitempty"`
}

// +kubebuilder:object:root=true
// +genclient
// +genclient:noStatus
// +kubebuilder:printcolumn:name="state",type=string,JSONPath=`.status.state`
// +kubebuilder:printcolumn:name="age",type=date,JSONPath=`.metadata.creationTimestamp`
// +kubebuilder:printcolumn:name="clusterid",type=string,JSONPath=`.spec.clusterId`

// SFServiceInstance is the Schema for the sfserviceinstances API
type SFServiceInstance struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   SFServiceInstanceSpec   `json:"spec,omitempty"`
	Status SFServiceInstanceStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// SFServiceInstanceList contains a list of SFServiceInstance
type SFServiceInstanceList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []SFServiceInstance `json:"items"`
}

func init() {
	SchemeBuilder.Register(&SFServiceInstance{}, &SFServiceInstanceList{})
}

// GetState fetches the state of the SFServiceInstance
func (r *SFServiceInstance) GetState() string {
	log := ctrl.Log.WithName("SFServiceInstance")
	if r == nil || r.Status.State == "" {
		log.V(2).Info("failed to read state")
		return ""
	}
	return r.Status.State
}

// SetState updates the state of the SFServiceInstance
func (r *SFServiceInstance) SetState(state string) {
	if r != nil {
		r.Status.State = state
	}
}

// GetClusterID fetches the ClusterID of the SFServiceInstance
func (r *SFServiceInstance) GetClusterID() (string, error) {
	log := ctrl.Log.WithName("SFServiceInstance")
	if r == nil || r.Spec.ClusterID == "" {
		log.V(2).Info("failed to read ClusterID")
		return "", errors.NewClusterIDNotSet(r.GetName(), nil)
	}
	return r.Spec.ClusterID, nil
}

// Get Labels converted to string from map[string]string for Metrics
func (r *SFServiceInstance) GetLabelsForMetrics() string {
	log := ctrl.Log.WithName("SFServiceInstance:GetLabelsForMetrics")
	if r == nil {
		log.V(2).Info("failed to read Labels For Metrics")
		return ""
	}
	log.V(2).Info("Getting Labels converted to string")

	//labelsJson := make(map[string]string)
	labelsJson := r.GetLabels()
	labelsStrArr := make([]string, 0)
	for k, v := range labelsJson {
		labelsStrArr = append(labelsStrArr, fmt.Sprintf("%s:%s", k, v))
	}

	return strings.Join(labelsStrArr, ",")
}

func (r *SFServiceInstance) GetLastOperation() string {
	log := ctrl.Log.WithName("SFServiceInstance")
	if r == nil {
		log.V(2).Info("failed to read last operation: instance details are nil")
		return ""
	}
	labels := r.GetLabels()
	if labels == nil {
		labels = make(map[string]string)
	}
	lastOperation, exists := labels[constants.LastOperationKey]
	if !exists {
		log.V(2).Info("failed to read last operation: last operation not found")
		return ""
	}
	return lastOperation
}

func (r *SFServiceInstance) GetDeletionTimestampForMetrics() string {
	log := ctrl.Log.WithName("SFServiceInstance")
	if r == nil || r.GetDeletionTimestamp() == nil {
		log.V(2).Info("Failed to read deletion timestamp OR not set deletion timestamp yet. Ignore if deletion is not called yet.")
		return ""
	}
	return r.GetDeletionTimestamp().String()
}
