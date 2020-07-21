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
	"context"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	runtime "k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
)

// SFServiceBindingSpec defines the desired state of SFServiceBinding
type SFServiceBindingSpec struct {
	ID         string `json:"id,omitempty"`
	InstanceID string `json:"instanceId"`
	PlanID     string `json:"planId"`
	ServiceID  string `json:"serviceId"`
	AppGUID    string `json:"appGuid,omitempty"`

	// +kubebuilder:pruning:PreserveUnknownFields
	BindResource *runtime.RawExtension `json:"bindResource,omitempty"`

	// +kubebuilder:pruning:PreserveUnknownFields
	RawContext *runtime.RawExtension `json:"context,omitempty"`

	// +kubebuilder:pruning:PreserveUnknownFields
	RawParameters     *runtime.RawExtension `json:"parameters,omitempty"`
	AcceptsIncomplete bool                  `json:"acceptsIncomplete,omitempty"`
}

// SFServiceBindingStatus defines the observed state of SFServiceBinding
type SFServiceBindingStatus struct {
	State       string               `yaml:"state,omitempty" json:"state,omitempty"`
	Error       string               `yaml:"error,omitempty" json:"error,omitempty"`
	Response    BindingResponse      `yaml:"response,omitempty" json:"response,omitempty"`
	AppliedSpec SFServiceBindingSpec `yaml:"appliedSpec,omitempty" json:"appliedSpec,omitempty"`
	Resources   []Source             `yaml:"resources,omitempty" json:"resources,omitempty"`
}

// BindingResponse defines the details of the binding response
type BindingResponse struct {
	SecretRef string `yaml:"secretRef,omitempty" json:"secretRef,omitempty"`
}

// +kubebuilder:object:root=true
// +genclient
// +genclient:noStatus
// +kubebuilder:printcolumn:name="state",type=string,JSONPath=`.status.state`
// +kubebuilder:printcolumn:name="age",type=date,JSONPath=`.metadata.creationTimestamp`

// SFServiceBinding is the Schema for the sfservicebindings API
type SFServiceBinding struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   SFServiceBindingSpec   `json:"spec,omitempty"`
	Status SFServiceBindingStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// SFServiceBindingList contains a list of SFServiceBinding
type SFServiceBindingList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []SFServiceBinding `json:"items"`
}

func init() {
	SchemeBuilder.Register(&SFServiceBinding{}, &SFServiceBindingList{})
}

// GetState fetches the state of the SFServiceBinding
func (r *SFServiceBinding) GetState() string {
	log := ctrl.Log.WithName("SFServiceBinding").WithName(r.GetName())
	if r == nil || r.Status.State == "" {
		log.V(2).Info("failed to read state")
		return ""
	}
	return r.Status.State
}

// SetState updates the state of the SFServiceBinding
func (r *SFServiceBinding) SetState(state string) {
	if r != nil {
		r.Status.State = state
	}
}

// GetClusterID fetches the ClusterID of the SFServiceBinding
// WARN: This will fetch the corresponding SFServiceInstance
func (r *SFServiceBinding) GetClusterID(c kubernetes.Client) (string, error) {
	log := ctrl.Log.WithName("SFServiceBinding").WithName(r.GetName())
	instance := &SFServiceInstance{}
	var instanceKey = types.NamespacedName{
		Name:      r.Spec.InstanceID,
		Namespace: r.GetNamespace(),
	}
	err := c.Get(context.TODO(), instanceKey, instance)
	if err != nil {
		log.Error(err, "failed to get sfserviceinstance", "InstanceID", r.Spec.InstanceID, "BindingID", r.GetName())
		if apiErrors.IsNotFound(err) {
			return "", errors.NewSFServiceInstanceNotFound(r.Spec.InstanceID, err)
		}
		return "", err
	}
	return instance.GetClusterID()
}
