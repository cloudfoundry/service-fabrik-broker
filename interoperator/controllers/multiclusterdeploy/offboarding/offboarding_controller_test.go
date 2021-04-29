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
package offboarding

import (
	"context"
	"time"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
)

var _ = Describe("SFCluster Offboarding controller", func() {

	// Define utility constants for object names and testing timeouts/durations and intervals.
	const (
		sfClusterName      = "foo"
		secretName         = "bar"
		sfClusterNamespace = "default"

		timeout  = time.Second * 10
		duration = time.Second * 10
		interval = time.Millisecond * 250
	)

	Context("When offboarding SFCluster", func() {
		var (
			ctx                context.Context
			sfClusterLookupKey types.NamespacedName
			secretLookupKey    types.NamespacedName
			clusterInstance    *resourcev1alpha1.SFCluster
			testSecret         *corev1.Secret

			createdSfCluster *resourcev1alpha1.SFCluster
			createdSecret    *corev1.Secret
		)
		BeforeEach(func() {
			ctx = context.Background()
			sfClusterLookupKey = types.NamespacedName{Name: sfClusterName, Namespace: sfClusterNamespace}
			secretLookupKey = types.NamespacedName{Name: secretName, Namespace: sfClusterNamespace}

			clusterInstance = &resourcev1alpha1.SFCluster{
				TypeMeta: metav1.TypeMeta{
					APIVersion: "resource.servicefabrik.io/v1alpha1",
					Kind:       "SFCluster",
				},
				ObjectMeta: metav1.ObjectMeta{
					Name:      sfClusterName,
					Namespace: sfClusterNamespace,
				},
				Spec: resourcev1alpha1.SFClusterSpec{
					SecretRef: secretName,
				},
			}
			testSecret = &corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{
					Name:      secretName,
					Namespace: sfClusterNamespace,
				},
			}
		})
		It("Should add finalizers when SFCluster  and secret is created", func() {
			By("Creating SFCluster")
			Expect(k8sClient.Create(ctx, clusterInstance)).Should(Succeed())
			// After creating this SFCluster, let's verify finalizers are added
			createdSfCluster = &resourcev1alpha1.SFCluster{}
			Eventually(func() bool {
				err := k8sClient.Get(ctx, sfClusterLookupKey, createdSfCluster)
				if err != nil {
					return false
				}
				return len(createdSfCluster.GetFinalizers()) != 0
			}, timeout, interval).Should(BeTrue())

			// Let's make sure our SecretRef string value was properly converted/handled.
			Expect(createdSfCluster.Spec.SecretRef).Should(Equal(secretName))
			Expect(createdSfCluster.GetFinalizers()).Should(ContainElement(constants.InteroperatorFinalizerName))

			By("Creating Secret")
			// Create a secret
			Expect(k8sClient.Create(ctx, testSecret)).Should(Succeed())
			createdSecret = &corev1.Secret{}
			Eventually(func() bool {
				err := k8sClient.Get(ctx, secretLookupKey, createdSecret)
				return err == nil
			}, timeout, interval).Should(BeTrue())

			By("Updating the instance count")
			createdSfCluster.Status.ServiceInstanceCount = 1
			Expect(k8sClient.Status().Update(ctx, createdSfCluster)).Should(Succeed())

			//Verify owner reference is set for the secret
			Eventually(func() bool {
				err := k8sClient.Get(ctx, secretLookupKey, createdSecret)
				if err != nil {
					return false
				}
				return len(createdSecret.GetOwnerReferences()) != 0
			}, timeout, interval).Should(BeTrue())
			var kindTransform = func(o metav1.OwnerReference) string { return o.Kind }
			var nameTransform = func(o metav1.OwnerReference) string { return o.Name }
			kindMatcher := WithTransform(kindTransform, Equal("SFCluster"))
			nameMatcher := WithTransform(nameTransform, Equal(sfClusterName))
			Expect(createdSecret.GetOwnerReferences()).Should(ContainElement(And(kindMatcher, nameMatcher)))

			//Verify finalizers are set for the secret
			Eventually(func() bool {
				err := k8sClient.Get(ctx, secretLookupKey, createdSecret)
				if err != nil {
					return false
				}
				return len(createdSecret.GetFinalizers()) != 0
			}, timeout, interval).Should(BeTrue())
			Expect(createdSecret.GetFinalizers()).Should(ContainElement(constants.InteroperatorFinalizerName))
		})

		It("Should offboard cluster if instance count is zero", func() {
			By("Deleting Secret")
			Expect(k8sClient.Delete(ctx, createdSecret)).Should(Succeed())

			//Verify the secret is not deleted
			Consistently(func() bool {
				err := k8sClient.Get(ctx, secretLookupKey, createdSecret)
				return err == nil
			}, duration, interval).Should(BeTrue())

			By("Deleting SFCluster")
			Expect(k8sClient.Delete(ctx, createdSfCluster)).Should(Succeed())

			//Verify the sfcluster is not deleted
			Consistently(func() bool {
				err := k8sClient.Get(ctx, sfClusterLookupKey, createdSfCluster)
				return err == nil
			}, duration, interval).Should(BeTrue())

			By("Setting instance count to zero")
			createdSfCluster.Status.ServiceInstanceCount = 0
			Expect(k8sClient.Status().Update(ctx, createdSfCluster)).Should(Succeed())

			//Verify Sfcluster get deleted
			Eventually(func() bool {
				err := k8sClient.Get(ctx, sfClusterLookupKey, createdSfCluster)
				return err != nil
			}, timeout, interval).Should(BeTrue())

			//Verify secret get deleted
			Eventually(func() bool {
				err := k8sClient.Get(ctx, secretLookupKey, createdSecret)
				return err != nil
			}, timeout, interval).Should(BeTrue())
		})
	})
})
