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
	"context"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var c, c2 client.Client

var expectedRequest = reconcile.Request{NamespacedName: types.NamespacedName{Name: "foo", Namespace: "default"}}
var instanceKey = types.NamespacedName{Name: "instance-id", Namespace: "sf-instance-id"}

const timeout = time.Second * 5

var instance = &osbv1alpha1.SFServiceInstance{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "instance-id",
		Namespace: "sf-instance-id",
		Labels: map[string]string{
			"state": "in_queue",
		},
		Finalizers: []string{"foo"},
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
	instance2 := &osbv1alpha1.SFServiceInstance{}
	watchChannel := make(chan event.GenericEvent)

	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	_getWatchChannel := getWatchChannel
	defer func() {
		getWatchChannel = _getWatchChannel
	}()
	getWatchChannel = func(controllerName string) (<-chan event.GenericEvent, error) {
		return watchChannel, nil
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

	// Create a new namespace
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name: "sf-instance-id",
		},
	}
	g.Expect(c.Create(context.TODO(), ns)).NotTo(gomega.HaveOccurred())

	// Create the SFServiceInstance object with not ClusterID
	instance.SetFinalizers([]string{"foo"})
	instance.SetNamespace("sf-instance-id")
	g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())

	g.Expect(utils.DrainAllRequests(requests, timeout)).To(gomega.Equal(1))

	// Set clusterID as DefaultMasterClusterID
	instance.Spec.ClusterID = constants.DefaultMasterClusterID
	g.Expect(c.Update(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(utils.DrainAllRequests(requests, timeout)).To(gomega.Equal(1))

	// Set valid ClusterID
	instance.Spec.ClusterID = "2"
	g.Expect(c.Update(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	// State should be updated in master cluster
	g.Expect(c.Get(context.TODO(), instanceKey, instance)).NotTo(gomega.HaveOccurred())
	g.Expect(instance.GetState()).To(gomega.Equal("in progress"))

	// Fetch from sister cluster
	g.Expect(c2.Get(context.TODO(), instanceKey, instance2)).NotTo(gomega.HaveOccurred())
	g.Expect(instance2.Spec).To(gomega.Equal(instance.Spec))
	g.Expect(instance2.GetAnnotations()).To(gomega.Equal(instance.GetAnnotations()))

	instance2.SetState("succeeded")
	instance2.SetFinalizers([]string{"foo"})
	g.Expect(c2.Update(context.TODO(), instance2)).NotTo(gomega.HaveOccurred())
	// Trigger watch
	watchChannel <- event.GenericEvent{
		Meta:   instance2,
		Object: instance2,
	}
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	// State should be updated in master cluster
	g.Expect(c.Get(context.TODO(), instanceKey, instance)).NotTo(gomega.HaveOccurred())
	g.Expect(instance.GetState()).To(gomega.Equal("succeeded"))

	// Delete from master
	g.Expect(c.Delete(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())
	g.Expect(c.Get(context.TODO(), instanceKey, instance)).NotTo(gomega.HaveOccurred())
	instance.SetState("delete")
	g.Expect(c.Update(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	// Expect state to be delete and deletiontimestamp to be set for replica
	g.Expect(c2.Get(context.TODO(), instanceKey, instance2)).NotTo(gomega.HaveOccurred())
	g.Expect(instance2.GetState()).To(gomega.Equal("delete"))
	g.Expect(instance2.GetDeletionTimestamp()).NotTo(gomega.BeZero())

	// Remove finalizer from replica
	instance2.SetFinalizers([]string{})
	g.Expect(c2.Update(context.TODO(), instance2)).NotTo(gomega.HaveOccurred())
	watchChannel <- event.GenericEvent{
		Meta:   instance2,
		Object: instance2,
	}
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	g.Expect(c.Get(context.TODO(), instanceKey, instance)).NotTo(gomega.HaveOccurred())
	g.Expect(instance.GetState()).To(gomega.Equal("succeeded"))

	instance.SetFinalizers([]string{})
	g.Expect(c.Update(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
}

func TestReconcileSFServiceInstanceReplicator_setInProgress(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	var instance = &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "instance-id",
			Namespace: "default",
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
	var instanceKey = types.NamespacedName{Name: "instance-id", Namespace: "default"}

	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	r := &ReconcileSFServiceInstanceReplicator{
		Client:          c,
		scheme:          mgr.GetScheme(),
		clusterRegistry: nil,
	}
	type args struct {
		instance *osbv1alpha1.SFServiceInstance
	}
	tests := []struct {
		name    string
		args    args
		setup   func()
		wantErr bool
		cleanup func()
	}{
		{
			name: "Set the state to in progress",
			args: args{
				instance: instance,
			},
			setup: func() {
				instance.SetResourceVersion("")
				instance.SetState("in_queue")
				g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
			},
			wantErr: false,
			cleanup: func() {
				g.Expect(c.Get(context.TODO(), instanceKey, instance)).NotTo(gomega.HaveOccurred())
				g.Expect(instance.GetState()).To(gomega.Equal("in progress"))
				g.Expect(c.Delete(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
				g.Expect(c.Get(context.TODO(), instanceKey, instance)).To(gomega.HaveOccurred())
			},
		},
		{
			name: "fail if instance is gone",
			args: args{
				instance: instance,
			},
			setup: func() {
				instance.SetResourceVersion("")
				instance.SetState("in_queue")
				g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())

				//Modify it on api server and pass outdated value
				g.Expect(c.Get(context.TODO(), instanceKey, instance)).NotTo(gomega.HaveOccurred())
				g.Expect(c.Delete(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
			},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			if tt.cleanup != nil {
				defer tt.cleanup()
			}
			if err := r.setInProgress(tt.args.instance); (err != nil) != tt.wantErr {
				t.Errorf("ReconcileSFServiceInstanceReplicator.setInProgress() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
