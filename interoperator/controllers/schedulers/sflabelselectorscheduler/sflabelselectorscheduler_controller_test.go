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

package sflabelselectorscheduler

import (
	"context"
	"errors"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/schedulers/sfserviceinstancecounter"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
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

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
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

	scheduler := &SFLabelSelectorScheduler{
		Client: mgr.GetClient(),
		Log:    ctrlrun.Log.WithName("schedulers").WithName("labelselector"),
	}
	g.Expect(scheduler.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
	SFServiceInstanceCounter := &sfserviceinstancecounter.SFServiceInstanceCounter{
		Client: mgr.GetClient(),
		Log:    ctrlrun.Log.WithName("scheduler-helper").WithName("sfserviceinstance-counter"),
	}
	g.Expect(SFServiceInstanceCounter.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())

	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	sfcluster1 := _getDummySFCLuster("1", map[string]string{
		"organization": "organization-guid",
	})
	sfcluster2 := _getDummySFCLuster("2", map[string]string{
		"organization": "organization-guid",
	})
	// label1, _ := labels.Parse("organization=organization-guid")

	sfcluster3 := _getDummySFCLuster("3", map[string]string{
		"plan": "plan-id-2",
	})

	g.Expect(c.Create(context.TODO(), sfcluster1)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), sfcluster2)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), sfcluster3)).NotTo(gomega.HaveOccurred())
	// label2, _ := labels.Parse("plan=plan-id-2")

	// label3, _ := labels.Parse("planId=plan-id-4,serviceId=service-id")

	clusterSelectorAction1 := "{{- $organizationGuid := \"\" }}\n{{- with .instance.spec.organizationGuid }} {{ $organizationGuid = . }} {{ end }}\norganization={{ $organizationGuid }}\n"
	plan1 := _getDummySFPlan("plan-id-1", clusterSelectorAction1)
	g.Expect(c.Create(context.TODO(), plan1)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), plan1)

	clusterSelectorAction2 := "{{- $planId := \"\" }}\n{{- with .instance.spec.planId }} {{ $planId = . }} {{ end }}\nplan={{ $planId }}\n"
	plan2 := _getDummySFPlan("plan-id-2", clusterSelectorAction2)
	g.Expect(c.Create(context.TODO(), plan2)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), plan2)

	service1 := _getDummySFService("service-id")
	g.Expect(c.Create(context.TODO(), service1)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), service1)

	// when cluster selector evaluates to single cluster
	instance1 := _getDummySFServiceInstance("foo1", "plan-id-1")
	g.Expect(c.Create(context.TODO(), instance1)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), instance1)

	instance2 := _getDummySFServiceInstance("foo2", "plan-id-2")
	g.Expect(c.Create(context.TODO(), instance2)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), instance2)

	g.Eventually(func() error {
		err := c.Get(context.TODO(), _getKey(instance1), instance1)
		if err != nil {
			return err
		}
		_, err = instance1.GetClusterID()
		if err != nil {
			return err
		}
		err = c.Get(context.TODO(), _getKey(instance2), instance2)
		if err != nil {
			return err
		}
		_, err = instance2.GetClusterID()
		if err != nil {
			return err
		}
		err = c.Get(context.TODO(), types.NamespacedName{
			Name:      "1",
			Namespace: constants.InteroperatorNamespace,
		}, sfcluster1)
		if err != nil {
			return err
		}
		serviceInstanceCount := sfcluster1.Status.ServiceInstanceCount
		if serviceInstanceCount != 1 {
			return errors.New("service intance count is not 1")
		}
		err = c.Get(context.TODO(), types.NamespacedName{
			Name:      "3",
			Namespace: constants.InteroperatorNamespace,
		}, sfcluster3)
		if err != nil {
			return err
		}
		serviceInstanceCount = sfcluster3.Status.ServiceInstanceCount
		if serviceInstanceCount != 1 {
			return errors.New("service intance count is not 1")
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance1.Spec.ClusterID).To(gomega.Equal(sfcluster1.GetName()))
	g.Expect(instance2.Spec.ClusterID).To(gomega.Equal(sfcluster3.GetName()))

	// when labelSelector action is not present in plan
	plan3 := _getDummySFPlan("plan-id-3", "")
	plan3.Spec.Templates = []osbv1alpha1.TemplateSpec{}
	g.Expect(c.Create(context.TODO(), plan3)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), plan3)
	instance3 := _getDummySFServiceInstance("foo3", "plan-id-3")
	g.Expect(c.Create(context.TODO(), instance3)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), instance3)
	g.Eventually(func() error {
		err := c.Get(context.TODO(), _getKey(instance3), instance3)
		if err != nil {
			return err
		}
		_, err = instance3.GetClusterID()
		if err != nil {
			return err
		}
		err = c.Get(context.TODO(), types.NamespacedName{
			Name:      "2",
			Namespace: constants.InteroperatorNamespace,
		}, sfcluster2)
		if err != nil {
			return err
		}
		serviceInstanceCount := sfcluster2.Status.ServiceInstanceCount
		if serviceInstanceCount != 1 {
			return errors.New("service intance count is not 1")
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance3.Spec.ClusterID).To(gomega.Equal(sfcluster2.GetName()))

	// label selector not selecting any cluster
	clusterSelectorAction3 := "{{- $planId := \"\" }}\n{{- with .instance.spec.planId }} {{ $planId = . }} {{ end }}\n{{- $serviceId := \"\" }}\n{{- with .instance.spec.serviceId }} {{ $serviceId = . }} {{ end }}\nplanId={{ $planId }},serviceId={{ $serviceId}}\n"
	plan4 := _getDummySFPlan("plan-id-4", clusterSelectorAction3)
	g.Expect(c.Create(context.TODO(), plan4)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), plan4)
	instance4 := _getDummySFServiceInstance("foo4", "plan-id-4")
	g.Expect(c.Create(context.TODO(), instance4)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), instance4)
	g.Eventually(func() error {
		err := c.Get(context.TODO(), _getKey(instance4), instance4)
		if err != nil {
			return err
		}
		_, err = instance4.GetClusterID()
		if err != nil {
			return err
		}
		return nil
	}, timeout).ShouldNot(gomega.Succeed())
	g.Expect(instance4.Spec.ClusterID).To(gomega.Equal(""))
}

func _getDummyConfigMap() *corev1.ConfigMap {
	data := make(map[string]string)
	config := "schedulerType: label-selector"
	data[constants.ConfigMapKey] = config
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      constants.ConfigMapName,
			Namespace: constants.InteroperatorNamespace,
		},
		Data: data,
	}
}

func _getDummySFPlan(name string, clusterSelector string) *osbv1alpha1.SFPlan {
	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action:  "clusterSelector",
			Type:    "gotemplate",
			Content: clusterSelector,
		},
	}
	return &osbv1alpha1.SFPlan{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: constants.InteroperatorNamespace,
		},
		Spec: osbv1alpha1.SFPlanSpec{
			Name:      "plan-name",
			ID:        name,
			Templates: templateSpec,
		},
	}
}

func _getDummySFService(name string) *osbv1alpha1.SFService {
	return &osbv1alpha1.SFService{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "service-id",
			Namespace: constants.InteroperatorNamespace,
			Labels:    map[string]string{"serviceId": "service-id"},
		},
		Spec: osbv1alpha1.SFServiceSpec{
			Name:                "service-name",
			ID:                  "service-id",
			Description:         "description",
			Tags:                []string{"foo", "bar"},
			Requires:            []string{"foo", "bar"},
			Bindable:            true,
			InstanceRetrievable: true,
			BindingRetrievable:  true,
			Metadata:            nil,
			DashboardClient: &osbv1alpha1.DashboardClient{
				ID:          "id",
				Secret:      "secret",
				RedirectURI: "redirecturi",
			},
			PlanUpdatable: true,
			RawContext:    nil,
		},
	}
}

func _getDummySFServiceInstance(name string, planID string) *osbv1alpha1.SFServiceInstance {
	return &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: constants.InteroperatorNamespace,
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
			ClusterID:        "",
		},
		Status: osbv1alpha1.SFServiceInstanceStatus{
			State: "in_queue",
		},
	}
}

func _getDummySFCLuster(name string, labels map[string]string) *resourcev1alpha1.SFCluster {
	return &resourcev1alpha1.SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: constants.InteroperatorNamespace,
			Labels:    labels,
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
