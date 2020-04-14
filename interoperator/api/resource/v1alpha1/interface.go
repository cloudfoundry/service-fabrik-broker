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
	"fmt"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
)

// GetKubeConfig return the kubeconfig of the cluster
func (cluster *SFCluster) GetKubeConfig(c kubernetes.Client) (*rest.Config, error) {
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

	cfg, err := clientcmd.RESTConfigFromKubeConfig(configBytes)
	if err != nil {
		return nil, err
	}
	return cfg, nil
}

// SFClusterInterface is defined so that and SFCluster can be mocked in tests
// +kubebuilder:object:generate=false
//go:generate mockgen -destination ./mock_sfcluster/mock_sfcluster.go github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1 SFClusterInterface
type SFClusterInterface interface {
	metav1.Object
	GetKubeConfig(c kubernetes.Client) (*rest.Config, error)
}

var _ SFClusterInterface = &SFCluster{}
