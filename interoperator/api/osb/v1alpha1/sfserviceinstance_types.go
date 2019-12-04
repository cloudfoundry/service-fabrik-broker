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
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	runtime "k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
)

// SFServiceInstanceSpec defines the desired state of SFServiceInstance
type SFServiceInstanceSpec struct {
	ServiceID        string                `json:"serviceId"`
	PlanID           string                `json:"planId"`
	RawContext       *runtime.RawExtension `json:"context,omitempty"`
	OrganizationGUID string                `json:"organizationGuid,omitempty"`
	SpaceGUID        string                `json:"spaceGuid,omitempty"`
	RawParameters    *runtime.RawExtension `json:"parameters,omitempty"`
	PreviousValues   *runtime.RawExtension `json:"previousValues,omitempty"`
	ClusterID        string                `json:"clusterId,omitempty"`
}

// SFServiceInstanceStatus defines the observed state of SFServiceInstance
type SFServiceInstanceStatus struct {
	DashboardURL string                `yaml:"dashboardUrl,omitempty" json:"dashboardUrl,omitempty"`
	State        string                `yaml:"state" json:"state"`
	Error        string                `yaml:"error,omitempty" json:"error,omitempty"`
	Description  string                `yaml:"description,omitempty" json:"description,omitempty"`
	AppliedSpec  SFServiceInstanceSpec `yaml:"appliedSpec,omitempty" json:"appliedSpec,omitempty"`
	Resources    []Source              `yaml:"resources,omitempty" json:"resources,omitempty"`
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
	log := ctrl.Log.WithName("SFServiceInstance").WithName(r.GetName())
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
	log := ctrl.Log.WithName("SFServiceInstance").WithName(r.GetName())
	if r == nil || r.Spec.ClusterID == "" {
		log.V(2).Info("failed to read ClusterID")
		return "", errors.NewClusterIDNotSet(r.GetName(), nil)
	}
	return r.Spec.ClusterID, nil
}
