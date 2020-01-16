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
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/schedulers/sfdefaultscheduler"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
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

	_ = mgr.GetFieldIndexer().IndexField(&osbv1alpha1.SFServiceInstance{}, "spec.planId", func(o runtime.Object) []string {
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

	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	plan1 := _getDummyPlan("provisioncontent")
	g.Expect(c.Create(context.TODO(), plan1)).NotTo(gomega.HaveOccurred())

	instance1 := _getDummySFServiceInstance("foo1", "plan-id")
	g.Expect(c.Create(context.TODO(), instance1)).NotTo(gomega.HaveOccurred())

	instance2 := _getDummySFServiceInstance("foo2", "plan-id")
	g.Expect(c.Create(context.TODO(), instance2)).NotTo(gomega.HaveOccurred())

	plan2 := &osbv1alpha1.SFPlan{}
	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{
			Name:      "plan-id",
			Namespace: "default",
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
	g.Expect(c.Update(context.TODO(), plan2)).NotTo(gomega.HaveOccurred())

	plan3 := &osbv1alpha1.SFPlan{}
	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{
			Name:      "plan-id",
			Namespace: "default",
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
			Namespace: "default",
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
			Namespace: "default",
		}, instance2)
		if err != nil {
			return err
		}
		instance2State := instance2.Status.State
		if instance2State != "update" {
			return errors.New("service intance 2 state is not update")
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance1.Status.State).To(gomega.Equal("update"))

	g.Expect(c.Delete(context.TODO(), instance1)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Delete(context.TODO(), instance2)).NotTo(gomega.HaveOccurred())

}

func _getDummyConfigMap() *corev1.ConfigMap {
	data := make(map[string]string)
	config := "schedulerType: default"
	data[constants.ConfigMapKey] = config
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      constants.ConfigMapName,
			Namespace: constants.DefaultServiceFabrikNamespace,
		},
		Data: data,
	}
}

func _getDummySFServiceInstance(name string, planID string) *osbv1alpha1.SFServiceInstance {
	return &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "default",
			Labels: map[string]string{
				"state": "in_queue",
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
			Namespace:  "default",
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

func _getSFClusterList(clusters ...resourcev1alpha1.SFCluster) *resourcev1alpha1.SFClusterList {
	return &resourcev1alpha1.SFClusterList{
		Items: clusters,
	}
}

func _getKey(obj metav1.Object) types.NamespacedName {
	return types.NamespacedName{
		Name:      obj.GetName(),
		Namespace: obj.GetNamespace(),
	}
}
