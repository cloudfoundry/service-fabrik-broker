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

package sfservicesreplicator

import (
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/resource/v1alpha1"
	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	"golang.org/x/net/context"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var c, c2 client.Client

var expectedRequest = reconcile.Request{NamespacedName: types.NamespacedName{Name: "foo", Namespace: "default"}}

const timeout = time.Second * 2

func createAndTestSFServiceAndPlans(serviceName string, planName string, service *osbv1alpha1.SFService, plan *osbv1alpha1.SFPlan, t *testing.T, g *gomega.GomegaWithT, requests chan reconcile.Request) {
	err := c.Create(context.TODO(), service)
	if apierrors.IsInvalid(err) {
		t.Logf("failed to create object, got an invalid object error: %v", err)
		return
	}
	g.Expect(err).NotTo(gomega.HaveOccurred())

	err = c.Create(context.TODO(), plan)
	if apierrors.IsInvalid(err) {
		t.Logf("failed to create object, got an invalid object error: %v", err)
		return
	}
	g.Expect(err).NotTo(gomega.HaveOccurred())
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	err = c2.Get(context.TODO(), types.NamespacedName{Name: serviceName, Namespace: "default"}, service)
	g.Expect(err).NotTo(gomega.HaveOccurred())
	g.Expect(service.GetName()).To(gomega.Equal(serviceName))
	err = c.Get(context.TODO(), types.NamespacedName{Name: planName, Namespace: "default"}, plan)
	g.Expect(err).NotTo(gomega.HaveOccurred())

	err = c2.Get(context.TODO(), types.NamespacedName{Name: planName, Namespace: "default"}, plan)
	g.Expect(err).NotTo(gomega.HaveOccurred())
	g.Expect(plan.GetName()).To(gomega.Equal(planName))

	g.Expect(c.Delete(context.TODO(), plan)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Delete(context.TODO(), service)).NotTo(gomega.HaveOccurred())
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())
}

func TestReconcile(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	service1 := &osbv1alpha1.SFService{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: "default",
		},
		Spec: osbv1alpha1.SFServiceSpec{
			ID: "foo",
		},
	}
	var templateSpec = []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action:  "provision",
			Type:    "gotemplate",
			Content: "provisioncontent",
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
			Action:  "sources",
			Type:    "gotemplate",
			Content: "sourcescontent",
		},
	}
	plan1 := &osbv1alpha1.SFPlan{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "bar",
			Namespace: "default",
		},
		Spec: osbv1alpha1.SFPlanSpec{
			Name:          "plan-name",
			ID:            "plan-id",
			Description:   "description",
			Metadata:      nil,
			Free:          false,
			Bindable:      true,
			PlanUpdatable: true,
			Schemas:       nil,
			Templates:     templateSpec,
			ServiceID:     "service-id",
			RawContext:    nil,
			Manager:       nil,
		}}
	labels := make(map[string]string)
	labels["serviceId"] = "foo"
	plan1.SetLabels(labels)
	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	c2, err = client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

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

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)
	recFn, requests := SetupTestReconcile(newReconciler(mgr, mockClusterRegistry))
	g.Expect(add(mgr, recFn)).NotTo(gomega.HaveOccurred())
	mockClusterRegistry.EXPECT().GetClient("1").Return(c, nil).AnyTimes()
	mockClusterRegistry.EXPECT().GetClient("2").Return(c2, nil).AnyTimes()

	defer close(StartTestManager(mgr, g))

	g.Expect(c.Create(context.TODO(), sfcluster1)).NotTo(gomega.HaveOccurred())
	<-time.After(time.Second)
	g.Expect(c.Create(context.TODO(), sfcluster2)).NotTo(gomega.HaveOccurred())

	createAndTestSFServiceAndPlans("foo", "bar", service1, plan1, t, g, requests)

	g.Expect(c.Delete(context.TODO(), sfcluster1)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Delete(context.TODO(), sfcluster2)).NotTo(gomega.HaveOccurred())
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())
}
