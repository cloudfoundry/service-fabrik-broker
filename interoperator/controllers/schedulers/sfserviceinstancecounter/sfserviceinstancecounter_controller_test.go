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

package sfserviceinstancecounter

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/schedulers/sfdefaultscheduler"

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
	c = mgr.GetClient()

	g.Expect(c.Create(context.TODO(), configMap)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), configMap)

	sfcluster1 := &resourcev1alpha1.SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "1",
			Namespace: constants.InteroperatorNamespace,
		},
	}
	g.Expect(c.Create(context.TODO(), sfcluster1)).NotTo(gomega.HaveOccurred())

	SFServiceInstanceCounter := &SFServiceInstanceCounter{
		Client: mgr.GetClient(),
		Log:    ctrlrun.Log.WithName("scheduler-helper").WithName("sfserviceinstance-counter"),
	}
	g.Expect(SFServiceInstanceCounter.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())

	g.Expect((&sfdefaultscheduler.SFDefaultScheduler{
		Client: mgr.GetClient(),
		Log:    ctrlrun.Log.WithName("schedulers").WithName("default"),
	}).SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())

	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	sfCluster := &resourcev1alpha1.SFCluster{}

	// when cluster selector evaluates to single cluster
	instance1 := _getDummySFServiceInstance("foo1", "plan-id-1")
	g.Expect(c.Create(context.TODO(), instance1)).NotTo(gomega.HaveOccurred())
	//defer c.Delete(context.TODO(), instance1)
	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{
			Name:      "1",
			Namespace: constants.InteroperatorNamespace,
		}, sfCluster)
		if err != nil {
			return err
		}
		serviceInstanceCount := sfCluster.Status.ServiceInstanceCount
		if serviceInstanceCount != 1 {
			return fmt.Errorf("service instance count is not 1. current count = %d", serviceInstanceCount)
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	instance2 := _getDummySFServiceInstance("foo2", "plan-id-2")
	g.Expect(c.Create(context.TODO(), instance2)).NotTo(gomega.HaveOccurred())
	//defer c.Delete(context.TODO(), instance2)

	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{
			Name:      "1",
			Namespace: constants.InteroperatorNamespace,
		}, sfCluster)
		if err != nil {
			return err
		}
		serviceInstanceCount := sfCluster.Status.ServiceInstanceCount
		if serviceInstanceCount != 2 {
			return fmt.Errorf("service instance count is not 2. current count = %d", serviceInstanceCount)
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(sfCluster.Status.ServiceInstanceCount).To(gomega.Equal(2))

	g.Expect(c.Delete(context.TODO(), instance1)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Delete(context.TODO(), instance2)).NotTo(gomega.HaveOccurred())

	sfcluster2 := &resourcev1alpha1.SFCluster{}

	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{
			Name:      "foo1",
			Namespace: constants.InteroperatorNamespace,
		}, instance1)
		if err == nil {
			return errors.New("instance not deleted")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{
			Name:      "foo2",
			Namespace: constants.InteroperatorNamespace,
		}, instance2)
		if err == nil {
			return errors.New("instance not deleted")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{
			Name:      "1",
			Namespace: constants.InteroperatorNamespace,
		}, sfcluster2)
		if err != nil {
			return err
		}
		serviceInstanceCount := sfcluster2.Status.ServiceInstanceCount
		if serviceInstanceCount != 0 {
			return fmt.Errorf("service instance count is not 0. current count = %d", serviceInstanceCount)
		}
		return nil
	}, 2*timeout).Should(gomega.Succeed())
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
			//			ClusterID:        "1",
		},
		Status: osbv1alpha1.SFServiceInstanceStatus{
			State: "in_queue",
		},
	}
}
