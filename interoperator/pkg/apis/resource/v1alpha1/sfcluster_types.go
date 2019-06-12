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
	"context"
	"fmt"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
)

// SFClusterSpec defines the desired state of SFCluster
type SFClusterSpec struct {
	// Name of the secret containing the kubeconfig required to access the
	// member cluster. The secret needs to exist in the same namespace
	// as the control plane and should have a "kubeconfig" key.
	SecretRef string `json:"secretRef"`
}

// SFClusterStatus defines the observed state of SFCluster
type SFClusterStatus struct {
}

// +genclient
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SFCluster is the Schema for the sfclusters API
// Name of SFCluster is the cluster ID
// +k8s:openapi-gen=true
type SFCluster struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   SFClusterSpec   `json:"spec,omitempty"`
	Status SFClusterStatus `json:"status,omitempty"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SFClusterList contains a list of SFCluster
type SFClusterList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []SFCluster `json:"items"`
}

func init() {
	SchemeBuilder.Register(&SFCluster{}, &SFClusterList{})
}

// GetKubeConfig return the kubeconfig of the cluster
func (cluster *SFCluster) GetKubeConfig(c kubernetes.Client) ([]byte, error) {
	var secretKey = types.NamespacedName{
		Name:      cluster.Spec.SecretRef,
		Namespace: cluster.GetNamespace(),
	}
	secret := &corev1.Secret{}
	err := c.Get(context.TODO(), secretKey, secret)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			return nil, errors.NewClusterRegistryError(fmt.Sprintf(
				"secret %s not found for cluster %s",
				cluster.Spec.SecretRef, cluster.GetName()), err)
		}
		return nil, err
	}
	configBytes, ok := secret.Data["kubeconfig"]
	if !ok {
		return nil, errors.NewClusterRegistryError(fmt.Sprintf(
			"key kubeconfig not found in cluster secret %s for cluster %s",
			cluster.Spec.SecretRef, cluster.GetName()), nil)
	}
	return configBytes, nil
}
