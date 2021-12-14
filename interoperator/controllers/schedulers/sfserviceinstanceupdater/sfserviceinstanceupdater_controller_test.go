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

package sfserviceinstanceupdater

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/schedulers/sfdefaultscheduler"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	ctrlrun "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
)

var c client.Client

const timeout = time.Second * 5

func TestReconcile(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	configMap := _getDummyConfigMap()

	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	g.Expect(c.Create(context.TODO(), configMap)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), configMap)

	_ = mgr.GetFieldIndexer().IndexField(context.TODO(), &osbv1alpha1.SFServiceInstance{}, "spec.planId", func(o client.Object) []string {
		planID := o.(*osbv1alpha1.SFServiceInstance).Spec.PlanID
		return []string{planID}
	})

	SFServiceInstanceUpdater := &SFServiceInstanceUpdater{
		Client: mgr.GetClient(),
		Log:    ctrlrun.Log.WithName("scheduler-helper").WithName("sfserviceinstance-updater"),
	}
	g.Expect(SFServiceInstanceUpdater.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())

	g.Expect((&sfdefaultscheduler.SFDefaultScheduler{
		Client: mgr.GetClient(),
		Log:    ctrlrun.Log.WithName("schedulers").WithName("default"),
	}).SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())

	cancelMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		cancelMgr()
		mgrStopped.Wait()
	}()

	plan1 := _getDummyPlan("provisioncontent")
	g.Expect(c.Create(context.TODO(), plan1)).NotTo(gomega.HaveOccurred())

	instance1 := _getDummySFServiceInstance("foo1", "plan-id", "in_queue")
	g.Expect(c.Create(context.TODO(), instance1)).NotTo(gomega.HaveOccurred())

	instance2 := _getDummySFServiceInstance("foo2", "plan-id", "update")
	g.Expect(c.Create(context.TODO(), instance2)).NotTo(gomega.HaveOccurred())

	instance3 := _getDummySFServiceInstance("foo3", "plan-id", "delete")
	g.Expect(c.Create(context.TODO(), instance3)).NotTo(gomega.HaveOccurred())

	plan2 := &osbv1alpha1.SFPlan{}
	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{
			Name:      "plan-id",
			Namespace: constants.InteroperatorNamespace,
		}, plan2)
		if err != nil {
			return err
		}
		if plan2.Status.SpecHash == "" {
			return errors.New("service plan specHash not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	plan2.Spec.Templates[0].Content = "modifiedContent"

	// creating an instance with this new spec hash
	// this instance should not be updated after applying plan
	// since annotation has this plan hash
	instance4 := _getDummySFServiceInstance("foo4", "plan-id", "in_queue")
	annotations := map[string]string{
		constants.PlanHashKey: utils.CalculateHash(plan2.Spec),
	}
	instance4.SetAnnotations(annotations)
	g.Expect(c.Create(context.TODO(), instance4)).NotTo(gomega.HaveOccurred())

	// apply after creating instance4
	g.Expect(c.Update(context.TODO(), plan2)).NotTo(gomega.HaveOccurred())

	plan3 := &osbv1alpha1.SFPlan{}
	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{
			Name:      "plan-id",
			Namespace: constants.InteroperatorNamespace,
		}, plan3)
		if err != nil {
			return err
		}
		previousResourceVersion, _ := strconv.Atoi(plan2.ResourceVersion)
		currentResourceVersion, _ := strconv.Atoi(plan3.ResourceVersion)
		if currentResourceVersion == (previousResourceVersion + 1) {
			return errors.New("resource version is not updated")
		}

		err = c.Get(context.TODO(), types.NamespacedName{
			Name:      "foo1",
			Namespace: constants.InteroperatorNamespace,
		}, instance1)
		if err != nil {
			return err
		}
		instance1State := instance1.Status.State
		if instance1State != "update" {
			return errors.New("service intance 1 state is not update")
		}
		err = c.Get(context.TODO(), types.NamespacedName{
			Name:      "foo2",
			Namespace: constants.InteroperatorNamespace,
		}, instance2)
		if err != nil {
			return err
		}
		instance2State := instance2.Status.State
		if instance2State != "update" {
			return errors.New("service intance 2 state is not update")
		}

		// instance3 with lastOperation as delete should not be update
		err = c.Get(context.TODO(), types.NamespacedName{
			Name:      "foo3",
			Namespace: constants.InteroperatorNamespace,
		}, instance3)
		if err != nil {
			return err
		}
		instance3State := instance3.Status.State
		if instance3State == "update" {
			return errors.New("instance with lastoperation as delete should not be updated")
		}

		// instance4 with latest planhash in annotation should not be update
		err = c.Get(context.TODO(), types.NamespacedName{
			Name:      "foo4",
			Namespace: constants.InteroperatorNamespace,
		}, instance4)
		if err != nil {
			return err
		}
		instance4State := instance4.Status.State
		if instance4State == "update" {
			return errors.New("instance with latest planhash in annotation should not be updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance1.Status.State).To(gomega.Equal("update"))

	g.Expect(c.Delete(context.TODO(), instance1)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Delete(context.TODO(), instance2)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Delete(context.TODO(), instance3)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Delete(context.TODO(), instance4)).NotTo(gomega.HaveOccurred())

}

func _getDummyConfigMap() *corev1.ConfigMap {
	data := make(map[string]string)
	config := "schedulerType: default"
	data[constants.ConfigMapKey] = config
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      constants.ConfigMapName,
			Namespace: constants.InteroperatorNamespace,
		},
		Data: data,
	}
}

func _getDummySFServiceInstance(name string, planID string, lastOperation string) *osbv1alpha1.SFServiceInstance {
	return &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: constants.InteroperatorNamespace,
			Labels: map[string]string{
				"state":                    "in_queue",
				constants.LastOperationKey: lastOperation,
			},
		},
		Spec: osbv1alpha1.SFServiceInstanceSpec{
			ServiceID:        "service-id",
			PlanID:           planID,
			RawContext:       nil,
			OrganizationGUID: "organization-guid",
			SpaceGUID:        "space-guid",
			RawParameters:    nil,
			PreviousValues:   nil,
			//			ClusterID:        "1",
		},
		Status: osbv1alpha1.SFServiceInstanceStatus{
			State: "in_queue",
		},
	}
}

func _getDummyPlan(provisionContent string) *osbv1alpha1.SFPlan {
	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action:  "provision",
			Type:    "gotemplate",
			Content: provisionContent,
		},
		osbv1alpha1.TemplateSpec{
			Action:  "bind",
			Type:    "gotemplate",
			Content: "bindcontent",
		},
		osbv1alpha1.TemplateSpec{
			Action:  "status",
			Type:    "gotemplate",
			Content: "statuscontent",
		},
		osbv1alpha1.TemplateSpec{
			Action: "sources",
			Type:   "gotemplate",
			Content: `secret:
  apiVersion: v1
  kind: Secret
  name: name
  namespace: namespace`,
		},
	}
	return &osbv1alpha1.SFPlan{
		ObjectMeta: metav1.ObjectMeta{
			Name:       "plan-id",
			Namespace:  constants.InteroperatorNamespace,
			Labels:     map[string]string{"serviceId": "service-id", "planId": "plan-id"},
			Finalizers: []string{"abc"},
		},
		Spec: osbv1alpha1.SFPlanSpec{
			Name:                "plan-name",
			ID:                  "plan-id",
			Description:         "description",
			Metadata:            nil,
			Free:                false,
			Bindable:            true,
			PlanUpdatable:       true,
			AutoUpdateInstances: true,
			Schemas:             nil,
			Templates:           templateSpec,
			ServiceID:           "service-id",
			RawContext:          nil,
			Manager:             nil,
		},
	}
}
