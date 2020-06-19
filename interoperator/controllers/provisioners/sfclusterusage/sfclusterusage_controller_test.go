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

package sfclusterusage

import (
	"context"
	"fmt"
	"time"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/scheme"
)

const timeout = time.Second * 5

var _ = Describe("SFClusterUsageReconciler", func() {

	Describe("Reconcile", func() {
		var (
			sfcluster          *resourcev1alpha1.SFCluster
			clusterKey         types.NamespacedName
			node1Key, node2Key types.NamespacedName
			node1, node2       *corev1.Node
			pod1Key, pod2Key   types.NamespacedName
			pod1, pod2         *corev1.Pod
		)

		BeforeEach(func() {
			node1 = _getDummyNode("node1")
			node1Key = types.NamespacedName{
				Name: "node1",
			}
			Expect(k8sClient.Create(context.TODO(), node1)).Should(Succeed())

			node2 = _getDummyNode("node2")
			node2Key = types.NamespacedName{
				Name: "node2",
			}
			Expect(k8sClient.Create(context.TODO(), node2)).Should(Succeed())

			pod1 = _getDummyPod("pod1")
			pod1Key = types.NamespacedName{
				Name:      pod1.GetName(),
				Namespace: pod1.GetNamespace(),
			}
			Expect(k8sClient.Create(context.TODO(), pod1)).Should(Succeed())

			pod2 = _getDummyPod("pod2")
			pod2Key = types.NamespacedName{
				Name:      pod2.GetName(),
				Namespace: pod2.GetNamespace(),
			}
			Expect(k8sClient.Create(context.TODO(), pod2)).Should(Succeed())
		})

		AfterEach(func(done Done) {
			Expect(k8sClient.Delete(context.TODO(), node1)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient.Get(context.TODO(), node1Key, node1)
				if apiErrors.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("node not deleted")
			}, timeout).Should(Succeed())

			Expect(k8sClient.Delete(context.TODO(), node2)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient.Get(context.TODO(), node2Key, node2)
				if apiErrors.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("node not deleted")
			}, timeout).Should(Succeed())

			Expect(k8sClient.Delete(context.TODO(), pod1)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient.Get(context.TODO(), pod1Key, pod1)
				if apiErrors.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("pod not deleted")
			}, timeout).Should(Succeed())

			Expect(k8sClient.Delete(context.TODO(), pod2)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient.Get(context.TODO(), pod2Key, pod2)
				if apiErrors.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("pod not deleted")
			}, timeout).Should(Succeed())

			close(done)
		})

		It("should compute cluster usage for own sfcluster", func(done Done) {
			sfcluster = _getDummySFCLuster(constants.OwnClusterID)
			clusterKey = types.NamespacedName{
				Name:      sfcluster.GetName(),
				Namespace: sfcluster.GetNamespace(),
			}
			Expect(k8sClient.Create(context.TODO(), sfcluster)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient.Get(context.TODO(), clusterKey, sfcluster)
				if err != nil {
					return err
				}
				currentCapacity := make(corev1.ResourceList)
				currentCapacity[corev1.ResourceCPU] = *resource.NewQuantity(2, resource.DecimalSI)
				if !resourcev1alpha1.ResourceListEqual(sfcluster.Status.CurrentCapacity, currentCapacity) {
					return fmt.Errorf("sfcluster status not computed")
				}
				return nil
			}, timeout).Should(Succeed())

			Expect(k8sClient.Delete(context.TODO(), sfcluster)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient.Get(context.TODO(), clusterKey, sfcluster)
				if apiErrors.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("cluster not deleted")
			}, timeout).Should(Succeed())

			close(done)
		}, 10)

		It("should not compute cluster usage for other sfcluster", func(done Done) {
			sfcluster = _getDummySFCLuster("cluster")
			clusterKey = types.NamespacedName{
				Name:      sfcluster.GetName(),
				Namespace: sfcluster.GetNamespace(),
			}
			Expect(k8sClient.Create(context.TODO(), sfcluster)).Should(Succeed())
			time.Sleep(time.Second)

			Expect(k8sClient.Get(context.TODO(), clusterKey, sfcluster)).Should(Succeed())
			Expect(sfcluster.Status.CurrentCapacity).Should(BeEmpty())

			Expect(k8sClient.Delete(context.TODO(), sfcluster)).Should(Succeed())
			Eventually(func() error {
				err := k8sClient.Get(context.TODO(), clusterKey, sfcluster)
				if apiErrors.IsNotFound(err) {
					return nil
				}
				return fmt.Errorf("cluster not deleted")
			}, timeout).Should(Succeed())

			close(done)
		}, 10)
	})

	Describe("SetupWithManager", func() {
		var r *SFClusterUsageReconciler

		BeforeEach(func() {
			r = &SFClusterUsageReconciler{
				Client: k8sClient,
				Scheme: scheme.Scheme,
			}
		})

		It("should not add the contoller if POD_NAMESPACE env is not set", func() {
			Expect(r.SetupWithManager(k8sManager)).Should(Succeed())
		})

		It("should add the contoller", func() {
			By("Initialising log")
			Expect(r.SetupWithManager(k8sManager)).Should(Succeed())
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

func _getDummyNode(name string) *corev1.Node {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: name,
		},
		Status: corev1.NodeStatus{
			Allocatable: make(corev1.ResourceList),
		},
	}
	node.Status.Allocatable[corev1.ResourceCPU] = *resource.NewQuantity(1, resource.DecimalSI)
	return node
}

func _getDummyPod(name string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: constants.InteroperatorNamespace,
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name:  name,
					Image: "image",
				},
			},
			InitContainers: []corev1.Container{
				{
					Name:  name + "init",
					Image: "image",
				},
			},
		},
	}
}
