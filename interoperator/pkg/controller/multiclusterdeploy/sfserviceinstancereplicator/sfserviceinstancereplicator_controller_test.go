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

package sfserviceinstancereplicator

import (
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	"golang.org/x/net/context"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var c, c2 client.Client

var expectedRequest = reconcile.Request{NamespacedName: types.NamespacedName{Name: "foo", Namespace: "default"}}
var instanceKey = types.NamespacedName{Name: "instance-id", Namespace: "default"}

const timeout = time.Second * 5

var instance = &osbv1alpha1.SFServiceInstance{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "instance-id",
		Namespace: "default",
		Labels: map[string]string{
			"state": "in_queue",
		},
	},
	Spec: osbv1alpha1.SFServiceInstanceSpec{
		ServiceID:        "service-id",
		PlanID:           "plan-id",
		RawContext:       nil,
		OrganizationGUID: "organization-guid",
		SpaceGUID:        "space-guid",
		RawParameters:    nil,
		PreviousValues:   nil,
	},
	Status: osbv1alpha1.SFServiceInstanceStatus{
		State: "in_queue",
	},
}

func TestReconcile(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	_getWatchChannel := getWatchChannel
	defer func() {
		getWatchChannel = _getWatchChannel
	}()
	getWatchChannel = func(controllerName string) (<-chan event.GenericEvent, error) {
		return make(chan event.GenericEvent), nil
	}

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c = mgr.GetClient()

	c2, err = client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)
	recFn, requests := SetupTestReconcile(newReconciler(mgr, mockClusterRegistry))
	g.Expect(add(mgr, recFn)).NotTo(gomega.HaveOccurred())

	mockClusterRegistry.EXPECT().GetClient("2").Return(c2, nil).AnyTimes()

	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	// Create the SFServiceInstance object with not ClusterID
	g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())

	g.Expect(utils.DrainAllRequests(requests, timeout)).To(gomega.Equal(1))

	instance.Spec.ClusterID = constants.MasterClusterID
	g.Expect(c.Update(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(utils.DrainAllRequests(requests, timeout)).To(gomega.Equal(1))

	instance.Spec.ClusterID = "2"
	g.Expect(c.Update(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	g.Expect(c.Get(context.TODO(), instanceKey, instance)).NotTo(gomega.HaveOccurred())
	g.Expect(instance.GetState()).To(gomega.Equal("in progress"))

	defer c.Delete(context.TODO(), instance)
	//g.Eventually(requests, timeout).Should(gomega.Receive(gomega.Equal(expectedRequest)))

}
