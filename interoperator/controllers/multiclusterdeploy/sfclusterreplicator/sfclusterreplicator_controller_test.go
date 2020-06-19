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

package sfclusterreplicator

import (
	"context"
	"fmt"
	"time"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
	v1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/event"
)

const timeout = time.Second * 5

var _ = Describe("SFClusterReplicator", func() {

	Describe("Reconcile", func() {
		var (
			sfcluster, sfcluster2, replica2 *resourcev1alpha1.SFCluster
			clusterKey, clusterKey2         types.NamespacedName
		)
		BeforeEach(func() {
			sfcluster = _getDummySFCLuster(constants.OwnClusterID)
			clusterKey = types.NamespacedName{
				Name:      constants.OwnClusterID,
				Namespace: constants.InteroperatorNamespace,
			}
			Expect(k8sClient.Create(context.TODO(), sfcluster)).Should(Succeed())

			sfcluster2 = _getDummySFCLuster("sister-cluster")
			clusterKey2 = types.NamespacedName{
				Name:      "sister-cluster",
				Namespace: constants.InteroperatorNamespace,
			}
			Expect(k8sClient.Create(context.TODO(), sfcluster2)).Should(Succeed())
			mockClusterRegistry.EXPECT().GetClient("sister-cluster").Return(k8sClient2, nil).AnyTimes()

			replica2 = _getDummySFCLuster("sister-cluster")
			Expect(k8sClient2.Create(context.TODO(), replica2)).Should(Succeed())
		})
		AfterEach(func(done Done) {
			Expect(k8sClient2.Delete(context.TODO(), replica2)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient2.Get(context.TODO(), clusterKey2, replica2)
				if apiErrors.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("sfcluster not deleted")
			}, timeout).Should(Succeed())
			// Trigger watch
			watchChannel <- event.GenericEvent{
				Meta:   replica2,
				Object: replica2,
			}

			Expect(k8sClient.Delete(context.TODO(), sfcluster)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient.Get(context.TODO(), clusterKey, sfcluster)
				if apiErrors.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("sfcluster not deleted")
			}, timeout).Should(Succeed())

			Expect(k8sClient.Delete(context.TODO(), sfcluster2)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient.Get(context.TODO(), clusterKey2, sfcluster2)
				if apiErrors.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("sfcluster2 not deleted")
			}, timeout).Should(Succeed())

			close(done)
		})

		It("should replicate sfcluster spec from master to sister", func(done Done) {
			sfcluster2.Spec.SecretRef = "new-secret-ref"
			sfcluster2.Spec.SchedulingLimitPercentage = 80
			sfcluster2.Spec.TotalCapacity = make(v1.ResourceList)
			sfcluster2.Spec.TotalCapacity[v1.ResourceMemory] = *resource.NewQuantity(1024, resource.BinarySI)
			Expect(k8sClient.Update(context.TODO(), sfcluster2)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient2.Get(context.TODO(), clusterKey2, replica2)
				if err != nil {
					return err
				}
				if replica2.Spec.SecretRef != "new-secret-ref" {
					return fmt.Errorf("sfcluster spec not replicated")
				}
				return nil
			}, timeout).Should(Succeed())
			close(done)
		}, 5)

		It("should replicate sfcluster status from sister to master", func(done Done) {
			replica2.Status.Requests = make(v1.ResourceList)
			replica2.Status.Requests[v1.ResourceCPU] = *resource.NewQuantity(1, resource.DecimalSI)
			replica2.Status.CurrentCapacity = make(v1.ResourceList)
			replica2.Status.CurrentCapacity[v1.ResourceCPU] = *resource.NewQuantity(1, resource.DecimalSI)
			replica2.Status.TotalCapacity = make(v1.ResourceList)
			replica2.Status.TotalCapacity[v1.ResourceCPU] = *resource.NewQuantity(1, resource.DecimalSI)
			Expect(k8sClient2.Status().Update(context.TODO(), replica2)).Should(Succeed())

			// Trigger watch
			watchChannel <- event.GenericEvent{
				Meta:   replica2,
				Object: replica2,
			}

			Eventually(func() error {
				err := k8sClient.Get(context.TODO(), clusterKey2, sfcluster2)
				if err != nil {
					return err
				}
				fmt.Println(sfcluster2.Status.Requests)
				if !sfcluster2.Status.Requests.Cpu().Equal(*resource.NewQuantity(1, resource.DecimalSI)) {
					return fmt.Errorf("sfcluster status not replicated")
				}
				return nil
			}, timeout).Should(Succeed())
			close(done)
		}, 5)
	})

	Describe("SetupWithManager", func() {
		var r *SFClusterReplicator
		_getWatchChannel := getWatchChannel
		watchChannel := make(chan event.GenericEvent)

		BeforeEach(func() {
			r = &SFClusterReplicator{
				Client: k8sClient,
				Scheme: scheme.Scheme,
			}
			getWatchChannel = func(controllerName string) (<-chan event.GenericEvent, error) {
				return watchChannel, nil
			}
		})
		AfterEach(func() {
			getWatchChannel = _getWatchChannel
		})

		It("should add the contoller", func() {
			By("Initialising log and cluster register")
			Expect(r.SetupWithManager(k8sManager)).Should(Succeed())
		})

		It("should fail if watch channel fails", func() {
			getWatchChannel = func(controllerName string) (<-chan event.GenericEvent, error) {
				return nil, fmt.Errorf("some error")
			}
			Expect(r.SetupWithManager(k8sManager)).ShouldNot(Succeed())
		})

	})
})

func _getDummySFCLuster(name string) *resourcev1alpha1.SFCluster {
	return &resourcev1alpha1.SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: constants.InteroperatorNamespace,
		},
		Spec: resourcev1alpha1.SFClusterSpec{
			SecretRef: name,
		},
	}
}
