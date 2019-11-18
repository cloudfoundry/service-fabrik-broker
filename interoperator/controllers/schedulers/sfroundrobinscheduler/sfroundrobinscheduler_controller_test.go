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

package sfroundrobinscheduler

import (
	"context"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
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

func createAndTestSFServiceInstance(clusterName string, instanceName string, instance *osbv1alpha1.SFServiceInstance, t *testing.T, g *gomega.GomegaWithT) {
	// Create the SFRoundRobinScheduler object and expect the Reconcile
	err := c.Create(context.TODO(), instance)
	// The instance object may not be a valid object because it might be missing some required fields.
	// Please modify the instance object by adding required fields and then remove the following if statement.
	if apierrors.IsInvalid(err) {
		t.Logf("failed to create object, got an invalid object error: %v", err)
		return
	}
	g.Expect(err).NotTo(gomega.HaveOccurred())
	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{Name: instanceName, Namespace: "default"}, instance)
		if err != nil {
			return err
		}
		_, err = instance.GetClusterID()
		if err != nil {
			return err
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(instance.Spec.ClusterID).To(gomega.Equal(clusterName))

	defer c.Delete(context.TODO(), instance)
}

func TestReconcileDifferentTimeStamp(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	instance := &osbv1alpha1.SFServiceInstance{ObjectMeta: metav1.ObjectMeta{Name: "foo", Namespace: "default"}}
	instance2 := &osbv1alpha1.SFServiceInstance{ObjectMeta: metav1.ObjectMeta{Name: "foo2", Namespace: "default"}}
	instance3 := &osbv1alpha1.SFServiceInstance{ObjectMeta: metav1.ObjectMeta{Name: "foo3", Namespace: "default"}}
	instance4 := &osbv1alpha1.SFServiceInstance{ObjectMeta: metav1.ObjectMeta{Name: "foo4", Namespace: "default"}}
	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c = mgr.GetClient()

	data := make(map[string]string)
	config := "schedulerType: round-robin"
	data[constants.ConfigMapKey] = config
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      constants.ConfigMapName,
			Namespace: constants.DefaultServiceFabrikNamespace,
		},
		Data: data,
	}

	sfcluster1 := &resourcev1alpha1.SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "1",
			Namespace: constants.DefaultServiceFabrikNamespace,
		},
	}

	sfcluster2 := &resourcev1alpha1.SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "2",
			Namespace: constants.DefaultServiceFabrikNamespace,
		},
	}

	sfcluster3 := &resourcev1alpha1.SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "3",
			Namespace: constants.DefaultServiceFabrikNamespace,
		},
	}

	g.Expect(c.Create(context.TODO(), configMap)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), sfcluster1)).NotTo(gomega.HaveOccurred())
	<-time.After(time.Second)
	g.Expect(c.Create(context.TODO(), sfcluster2)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), sfcluster3)).NotTo(gomega.HaveOccurred())

	g.Expect((&SFRoundRobinScheduler{
		Client: mgr.GetClient(),
		Log:    ctrlrun.Log.WithName("schedulers").WithName("roundrobin"),
	}).SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	createAndTestSFServiceInstance("1", "foo", instance, t, g)
	createAndTestSFServiceInstance("2", "foo2", instance2, t, g)
	createAndTestSFServiceInstance("3", "foo3", instance3, t, g)
	createAndTestSFServiceInstance("1", "foo4", instance4, t, g)
}
