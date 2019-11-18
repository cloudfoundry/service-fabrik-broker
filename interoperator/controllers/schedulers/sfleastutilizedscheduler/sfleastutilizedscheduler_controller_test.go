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

package sfleastutilizedscheduler

import (
	"context"
	"fmt"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	ctrlrun "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var c client.Client

var expectedRequest = reconcile.Request{NamespacedName: types.NamespacedName{Name: "foo", Namespace: "default"}}

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

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	g.Expect(c.Create(context.TODO(), configMap)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), configMap)

	scheduler := &SFLeastUtilizedScheduler{
		Client: mgr.GetClient(),
		Log:    ctrlrun.Log.WithName("schedulers").WithName("leastutilized"),
	}
	g.Expect(scheduler.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
	scheduler.clusterRegistry = mockClusterRegistry
	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	sfcluster1 := _getDummySFCLuster("1")
	sfcluster2 := _getDummySFCLuster("2")
	sfcluster3 := _getDummySFCLuster("3")

	// First error
	call1 := mockClusterRegistry.EXPECT().ListClusters(&client.ListOptions{}).
		Return(nil, fmt.Errorf("some error")).Times(1)
	// Second time no clusters
	call2 := mockClusterRegistry.EXPECT().ListClusters(&client.ListOptions{}).
		Return(_getSFClusterList(), nil).Times(1).After(call1)
	// For first 4 instance only 2 Clusters
	call3 := mockClusterRegistry.EXPECT().ListClusters(&client.ListOptions{}).
		Return(_getSFClusterList(sfcluster1, sfcluster2), nil).Times(4).After(call2)

	instance1 := _getDummySFServiceInstance("foo1")
	g.Expect(c.Create(context.TODO(), instance1)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), instance1)

	g.Eventually(func() error {
		err := c.Get(context.TODO(), _getKey(instance1), instance1)
		if err != nil {
			return err
		}
		_, err = instance1.GetClusterID()
		if err != nil {
			return err
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance1.Spec.ClusterID).To(gomega.Equal(sfcluster1.GetName()))

	instance2 := _getDummySFServiceInstance("foo2")
	g.Expect(c.Create(context.TODO(), instance2)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), instance2)

	g.Eventually(func() error {
		err := c.Get(context.TODO(), _getKey(instance2), instance2)
		if err != nil {
			return err
		}
		_, err = instance2.GetClusterID()
		if err != nil {
			return err
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance2.Spec.ClusterID).To(gomega.Equal(sfcluster2.GetName()))

	instance3 := _getDummySFServiceInstance("foo3")
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
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance3.Spec.ClusterID).To(gomega.Equal(sfcluster1.GetName()))

	instance4 := _getDummySFServiceInstance("foo4")
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
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance4.Spec.ClusterID).To(gomega.Equal(sfcluster2.GetName()))

	// Next two instances three clusters
	call4 := mockClusterRegistry.EXPECT().ListClusters(&client.ListOptions{}).
		Return(_getSFClusterList(sfcluster1, sfcluster2, sfcluster3), nil).Times(2).After(call3)

	instance5 := _getDummySFServiceInstance("foo5")
	g.Expect(c.Create(context.TODO(), instance5)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), instance5)

	g.Eventually(func() error {
		err := c.Get(context.TODO(), _getKey(instance5), instance5)
		if err != nil {
			return err
		}
		_, err = instance5.GetClusterID()
		if err != nil {
			return err
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance5.Spec.ClusterID).To(gomega.Equal(sfcluster3.GetName()))

	instance6 := _getDummySFServiceInstance("foo6")
	g.Expect(c.Create(context.TODO(), instance6)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), instance6)

	g.Eventually(func() error {
		err := c.Get(context.TODO(), _getKey(instance6), instance6)
		if err != nil {
			return err
		}
		_, err = instance6.GetClusterID()
		if err != nil {
			return err
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance6.Spec.ClusterID).To(gomega.Equal(sfcluster3.GetName()))

	// Next instance only one cluster
	mockClusterRegistry.EXPECT().ListClusters(&client.ListOptions{}).
		Return(_getSFClusterList(sfcluster3), nil).Times(1).After(call4)

	instance7 := _getDummySFServiceInstance("foo7")
	g.Expect(c.Create(context.TODO(), instance7)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), instance7)

	g.Eventually(func() error {
		err := c.Get(context.TODO(), _getKey(instance7), instance7)
		if err != nil {
			return err
		}
		_, err = instance7.GetClusterID()
		if err != nil {
			return err
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance7.Spec.ClusterID).To(gomega.Equal(sfcluster3.GetName()))
}

func _getDummySFServiceInstance(name string) *osbv1alpha1.SFServiceInstance {
	return &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "default",
		},
	}
}

func _getDummySFCLuster(name string) resourcev1alpha1.SFCluster {
	return resourcev1alpha1.SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: constants.DefaultServiceFabrikNamespace,
		},
	}
}

func _getDummyConfigMap() *corev1.ConfigMap {
	data := make(map[string]string)
	config := "schedulerType: least-utilized"
	data[constants.ConfigMapKey] = config
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      constants.ConfigMapName,
			Namespace: constants.DefaultServiceFabrikNamespace,
		},
		Data: data,
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
