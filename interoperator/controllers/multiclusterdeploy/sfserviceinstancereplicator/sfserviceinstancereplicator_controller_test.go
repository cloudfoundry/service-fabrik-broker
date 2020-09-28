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
	"fmt"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	ctrlrun "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var c, c2 client.Client

var expectedRequest = reconcile.Request{NamespacedName: types.NamespacedName{Name: "foo", Namespace: constants.InteroperatorNamespace}}
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
	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
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

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)
	mockClusterRegistry.EXPECT().GetClient("2").Return(c2, nil).AnyTimes()

	controller := &InstanceReplicator{
		Client:          mgr.GetClient(),
		Log:             ctrlrun.Log.WithName("mcd").WithName("replicator").WithName("instance"),
		clusterRegistry: mockClusterRegistry,
	}
	g.Expect(controller.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
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

	// Set clusterID as OwnClusterID
	err = retry.RetryOnConflict(retry.DefaultBackoff, func() error {
		err = c.Get(context.TODO(), instanceKey, instance)
		if err != nil {
			return err
		}
		instance.Spec.ClusterID = constants.OwnClusterID
		return c.Update(context.TODO(), instance)
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	time.Sleep(timeout)

	// Set valid ClusterID
	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		err = c.Get(context.TODO(), instanceKey, instance)
		if err != nil {
			return err
		}
		instance.Spec.ClusterID = "2"
		return c.Update(context.TODO(), instance)
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	// State should be updated in master cluster
	g.Eventually(func() error {
		err := c.Get(context.TODO(), instanceKey, instance)
		if err != nil {
			return err
		}
		state := instance.GetState()
		if state != "in progress" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	// Fetch from sister cluster
	g.Eventually(func() error {
		err := c2.Get(context.TODO(), instanceKey, instance2)
		if err != nil {
			return err
		}

		match, err := gomega.Equal(instance.Spec).Match(instance2.Spec)
		if err != nil {
			return err
		}
		if !match {
			return fmt.Errorf("spec not matched in sister")
		}

		match, err = gomega.Equal(instance.GetAnnotations()).Match(instance2.GetAnnotations())
		if err != nil {
			return err
		}
		if !match {
			return fmt.Errorf("annotations not matched in sister")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		err = c2.Get(context.TODO(), instanceKey, instance2)
		if err != nil {
			return err
		}
		instance2.SetState("succeeded")
		instance2.SetFinalizers([]string{"foo"})
		return c2.Update(context.TODO(), instance2)
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	// Trigger watch
	watchChannel <- event.GenericEvent{
		Meta:   instance2,
		Object: instance2,
	}

	// State should be updated in master cluster
	g.Eventually(func() error {
		err := c.Get(context.TODO(), instanceKey, instance)
		if err != nil {
			return err
		}
		state := instance.GetState()
		if state != "succeeded" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	// Delete instance from master cluster
	g.Expect(c.Delete(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Delete(context.TODO(), ns)).NotTo(gomega.HaveOccurred())
	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		instance.SetState("delete")
		err := c.Update(context.TODO(), instance)
		if err != nil {
			// The instance is possibly outdated, fetch it again and retry the
			// update operation.
			_ = c.Get(context.TODO(), instanceKey, instance)
			return err
		}
		return nil
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	// Expect state to be delete and deletiontimestamp to be set for replica
	g.Eventually(func() error {
		err := c2.Get(context.TODO(), instanceKey, instance2)
		if err != nil {
			return err
		}

		match, err := gomega.Equal(instance2.GetState()).Match("delete")
		if err != nil {
			return err
		}
		if !match {
			return fmt.Errorf("state not set to delete in sister")
		}

		match, err = gomega.BeZero().Match(instance2.GetDeletionTimestamp())
		if err != nil {
			return err
		}
		if match {
			return fmt.Errorf("deletion timestamp not set in sister")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	// Remove finalizer from replica
	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		err = c2.Get(context.TODO(), instanceKey, instance2)
		if err != nil {
			return err
		}
		instance2.SetFinalizers([]string{})
		return c2.Update(context.TODO(), instance2)
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	watchChannel <- event.GenericEvent{
		Meta:   instance2,
		Object: instance2,
	}

	g.Eventually(func() error {
		err := c.Get(context.TODO(), instanceKey, instance)
		if err != nil {
			return err
		}
		state := instance.GetState()
		if state != "succeeded" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		instance.SetFinalizers([]string{})
		err := c.Update(context.TODO(), instance)
		if err != nil {
			// The instance is possibly outdated, fetch it again and retry the
			// update operation.
			_ = c.Get(context.TODO(), instanceKey, instance)
			return err
		}
		return nil
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
}

func TestInstanceReplicator_setInProgress(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	var instance = &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "instance-id",
			Namespace: constants.InteroperatorNamespace,
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
	var instanceKey = types.NamespacedName{Name: "instance-id", Namespace: constants.InteroperatorNamespace}

	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	r := &InstanceReplicator{
		Client:          c,
		Log:             ctrlrun.Log.WithName("mcd").WithName("replicator").WithName("instance"),
		scheme:          mgr.GetScheme(),
		clusterRegistry: nil,
	}
	type args struct {
		instance *osbv1alpha1.SFServiceInstance
		state    string
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
				state:    "in_queue",
			},
			setup: func() {
				instance.SetResourceVersion("")
				instance.SetState("in_queue")
				instance.SetLabels(nil)
				g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
			},
			wantErr: false,
			cleanup: func() {
				g.Expect(c.Get(context.TODO(), instanceKey, instance)).NotTo(gomega.HaveOccurred())
				g.Expect(instance.GetState()).To(gomega.Equal("in progress"))
				g.Expect(instance.GetLabels()).To(gomega.HaveKeyWithValue(constants.LastOperationKey, "in_queue"))
				g.Expect(c.Delete(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
				g.Eventually(func() error {
					err := c.Get(context.TODO(), instanceKey, instance)
					if err != nil {
						if apierrors.IsNotFound(err) {
							return nil
						}
						return err
					}
					return fmt.Errorf("not deleted")
				}, timeout).Should(gomega.Succeed())
			},
		},
		{
			name: "Not Set the state to in progress if state is different",
			args: args{
				instance: instance,
				state:    "in_queue",
			},
			setup: func() {
				instance.SetResourceVersion("")
				instance.SetState("update")
				instance.SetLabels(nil)
				g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
			},
			wantErr: false,
			cleanup: func() {
				g.Expect(c.Get(context.TODO(), instanceKey, instance)).NotTo(gomega.HaveOccurred())
				g.Expect(instance.GetState()).NotTo(gomega.Equal("in progress"))
				g.Expect(instance.GetLabels()).NotTo(gomega.HaveKeyWithValue(constants.LastOperationKey, "in_queue"))
				g.Expect(c.Delete(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
				g.Eventually(func() error {
					err := c.Get(context.TODO(), instanceKey, instance)
					if err != nil {
						if apierrors.IsNotFound(err) {
							return nil
						}
						return err
					}
					return fmt.Errorf("not deleted")
				}, timeout).Should(gomega.Succeed())
			},
		},
		{
			name: "fail if instance is gone",
			args: args{
				instance: instance,
				state:    "in_queue",
			},
			setup: func() {
				g.Eventually(func() error {
					err := c.Get(context.TODO(), instanceKey, instance)
					if err != nil {
						if apierrors.IsNotFound(err) {
							return nil
						}
						return err
					}
					return fmt.Errorf("not deleted")
				}, timeout).Should(gomega.Succeed())
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
			if err := r.setInProgress(tt.args.instance, tt.args.state); (err != nil) != tt.wantErr {
				t.Errorf("InstanceReplicator.setInProgress() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
