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

package sfservicebindingreplicator

import (
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"
	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	"golang.org/x/net/context"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var c client.Client

var bindingKey = types.NamespacedName{Name: "binding-id", Namespace: "default"}

const timeout = time.Second * 5

var serviceInstance = &osbv1alpha1.SFServiceInstance{
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
		ClusterID:        "1",
	},
}

var binding = &osbv1alpha1.SFServiceBinding{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "binding-id",
		Namespace: "default",
		Labels: map[string]string{
			"state": "in_queue",
		},
	},
	Spec: osbv1alpha1.SFServiceBindingSpec{
		ID:                "binding-id",
		InstanceID:        "instance-id",
		PlanID:            "plan-id",
		ServiceID:         "service-id",
		AcceptsIncomplete: true,
	},
	Status: osbv1alpha1.SFServiceBindingStatus{
		State: "in_queue",
	},
}

func TestReconcileMasterCluster(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	_getWatchChannel := getWatchChannel
	defer func() {
		getWatchChannel = _getWatchChannel
	}()
	getWatchChannel = func(controllerName string) (<-chan event.GenericEvent, error) {
		return make(chan event.GenericEvent), nil
	}
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	c = mgr.GetClient()
	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)
	reconciler := newReconciler(mgr, mockClusterRegistry)
	recFn, requests := SetupTestReconcile(reconciler)
	g.Expect(add(mgr, recFn)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), serviceInstance)).NotTo(gomega.HaveOccurred())

	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	// Create the SFServiceBinding object and expect the Reconcile
	err = c.Create(context.TODO(), binding)
	// The binding object may not be a valid object because it might be missing some required fields.
	// Please modify the binding object by adding required fields and then remove the following if statement.
	if apierrors.IsInvalid(err) {
		t.Logf("failed to create object, got an invalid object error: %v", err)
		return
	}
	g.Expect(err).NotTo(gomega.HaveOccurred())
	// Reconciler recives the request and updates status and labels
	g.Expect(drainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	// Get the serviceBinding
	serviceBinding := &osbv1alpha1.SFServiceBinding{}
	g.Eventually(func() error {
		err := c.Get(context.TODO(), bindingKey, serviceBinding)
		if err != nil {
			return err
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	// Testing that replication doesn't happen for master cluster
	g.Expect(serviceBinding.Status.State).Should(gomega.Equal("in_queue"))
}

func drainAllRequests(requests <-chan reconcile.Request, remainingTime time.Duration) int {
	// Drain all requests
	select {
	case <-requests:
		return 1 + drainAllRequests(requests, remainingTime)
	case <-time.After(remainingTime):
		return 0
	}
}
