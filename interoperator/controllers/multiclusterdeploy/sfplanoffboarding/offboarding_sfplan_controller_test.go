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
package sfplanoffboarding

import (
	"context"
	"time"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

var _ = Describe("SFPlan Offboarding controller", func() {

	// Define utility constants for object names and testing timeouts/durations and intervals.
	const (
		sfPlanName      = "foo"
		instanceName    = "bar"
		sfPlanNamespace = "default"

		timeout  = time.Second * 10
		duration = time.Second * 10
		interval = time.Millisecond * 250
	)

	Context("When offboarding SFPlan", func() {
		var (
			ctx                      context.Context
			sfPlanLookupKey          types.NamespacedName
			sfInstanceLookupKey      types.NamespacedName
			planInstance             *osbv1alpha1.SFPlan
			sfServiceInstance        *osbv1alpha1.SFServiceInstance
			createdSfPlan            *osbv1alpha1.SFPlan
			createdSfServiceInstance *osbv1alpha1.SFServiceInstance
		)
		BeforeEach(func() {
			ctx = context.Background()
			sfPlanLookupKey = types.NamespacedName{Name: sfPlanName, Namespace: sfPlanNamespace}
			sfInstanceLookupKey = types.NamespacedName{Name: instanceName, Namespace: sfPlanNamespace}

			var instanceLabel = map[string]string{
				"plan_id": sfPlanName,
			}

			planInstance = &osbv1alpha1.SFPlan{
				ObjectMeta: metav1.ObjectMeta{
					Name:      sfPlanName,
					Namespace: sfPlanNamespace,
				},
				Spec: osbv1alpha1.SFPlanSpec{
					Name:          "plan-name",
					ID:            sfPlanName,
					Description:   "description",
					Metadata:      nil,
					Free:          false,
					Bindable:      true,
					PlanUpdatable: true,
					Schemas:       nil,
					ServiceID:     "service-id",
					RawContext:    nil,
					Manager:       nil,
					Templates:     []osbv1alpha1.TemplateSpec{},
				},
			}
			sfServiceInstance = &osbv1alpha1.SFServiceInstance{
				ObjectMeta: metav1.ObjectMeta{
					Name:      instanceName,
					Namespace: sfPlanNamespace,
					Labels:    instanceLabel,
				},
				Spec: osbv1alpha1.SFServiceInstanceSpec{
					ServiceID:        "service-id",
					PlanID:           sfPlanName,
					RawContext:       nil,
					OrganizationGUID: "organization-guid",
					SpaceGUID:        "space-guid",
					RawParameters:    nil,
					PreviousValues:   nil,
					ClusterID:        "1",
					InstanceID:       instanceName,
				},
				Status: osbv1alpha1.SFServiceInstanceStatus{
					State: "in_queue",
				},
			}
		})
		It("Should add finalizers when SFPlan is created", func() {
			By("Creating SFPlan")
			Expect(k8sClient.Create(ctx, planInstance)).Should(Succeed())
			// After creating this SFPlan, let's verify finalizers are added
			createdSfPlan = &osbv1alpha1.SFPlan{}
			Eventually(func() bool {
				err := k8sClient.Get(ctx, sfPlanLookupKey, createdSfPlan)
				if err != nil {
					return false
				}
				return len(createdSfPlan.GetFinalizers()) != 0
			}, timeout, interval).Should(BeTrue())

			Expect(createdSfPlan.Spec.ID).Should(Equal(sfPlanName))
			Expect(createdSfPlan.GetFinalizers()).Should(ContainElement(constants.FinalizerName))
		})

		It("Should offboard plan if instance count is zero", func() {
			By("Deleting SFPlan")
			Expect(k8sClient.Delete(ctx, createdSfPlan)).Should(Succeed())

			//Verify Sfplan get deleted
			Eventually(func() bool {
				err := k8sClient.Get(ctx, sfPlanLookupKey, createdSfPlan)
				return err != nil
			}, timeout, interval).Should(BeTrue())
		})

		It("Should not offboard plan if instance count is not zero", func() {
			By("Creating SFPlan")
			Expect(k8sClient.Create(ctx, planInstance)).Should(Succeed())
			// After creating this SFPlan, let's verify finalizers are added
			createdSfPlan = &osbv1alpha1.SFPlan{}
			Eventually(func() bool {
				err := k8sClient.Get(ctx, sfPlanLookupKey, createdSfPlan)
				if err != nil {
					return false
				}
				return len(createdSfPlan.GetFinalizers()) != 0
			}, timeout, interval).Should(BeTrue())
			Expect(createdSfPlan.Spec.ID).Should(Equal(sfPlanName))
			Expect(createdSfPlan.GetFinalizers()).Should(ContainElement(constants.FinalizerName))

			By("Creating SFServiceInstance")
			err := k8sClient.Create(context.TODO(), sfServiceInstance)
			if apierrors.IsInvalid(err) {
				return
			}
			Expect(err).NotTo(HaveOccurred())

			// After creating this SFServiceInstance, let's verify finalizers are added
			createdSfServiceInstance = &osbv1alpha1.SFServiceInstance{}
			Eventually(func() error {
				return k8sClient.Get(context.TODO(), sfInstanceLookupKey, createdSfServiceInstance)
			}, timeout).Should(Succeed())

			By("Deleting SFPlan")
			Expect(k8sClient.Delete(ctx, createdSfPlan)).Should(Succeed())

			//Verify the sfplan is not deleted
			Consistently(func() bool {
				err := k8sClient.Get(ctx, sfPlanLookupKey, createdSfPlan)
				return err == nil
			}, duration, interval).Should(BeTrue())

			By("Deleting SFServiceInstance")
			Expect(k8sClient.Delete(ctx, createdSfServiceInstance)).Should(Succeed())
		})
	})
})
