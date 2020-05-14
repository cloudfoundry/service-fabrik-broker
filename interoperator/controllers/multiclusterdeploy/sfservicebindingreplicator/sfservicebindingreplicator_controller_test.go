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
)

var c, c2 client.Client
var secretID = "sf-binding-id"
var bindingID = "binding-id"
var namespace = constants.InteroperatorNamespace
var bindingKey = types.NamespacedName{Name: bindingID, Namespace: constants.InteroperatorNamespace}
var secretKey = types.NamespacedName{Name: secretID, Namespace: constants.InteroperatorNamespace}
var serviceInstance *osbv1alpha1.SFServiceInstance
var binding, replicaBinding *osbv1alpha1.SFServiceBinding

const timeout = time.Second * 5

var objectMetaInstance = metav1.ObjectMeta{
	Name:      "instance-id",
	Namespace: constants.InteroperatorNamespace,
	Labels: map[string]string{
		"state": "in_queue",
	},
}

var specInstance = osbv1alpha1.SFServiceInstanceSpec{
	ServiceID:        "service-id",
	PlanID:           "plan-id",
	RawContext:       nil,
	OrganizationGUID: "organization-guid",
	SpaceGUID:        "space-guid",
	RawParameters:    nil,
	PreviousValues:   nil,
	ClusterID:        "1",
}

var objectMetaBinding = metav1.ObjectMeta{
	Name:      "binding-id",
	Namespace: constants.InteroperatorNamespace,
	Labels: map[string]string{
		"state": "in_queue",
	},
}

var specBinding = osbv1alpha1.SFServiceBindingSpec{
	ID:                "binding-id",
	InstanceID:        "instance-id",
	PlanID:            "plan-id",
	ServiceID:         "service-id",
	AcceptsIncomplete: true,
}

func doInitialSetup(watchChannel chan event.GenericEvent) {
	serviceInstance = &osbv1alpha1.SFServiceInstance{
		ObjectMeta: objectMetaInstance,
		Spec:       specInstance,
	}

	binding = &osbv1alpha1.SFServiceBinding{
		ObjectMeta: objectMetaBinding,
		Spec:       specBinding,
		Status: osbv1alpha1.SFServiceBindingStatus{
			State: "in_queue",
		},
	}
	replicaBinding = &osbv1alpha1.SFServiceBinding{
		ObjectMeta: objectMetaBinding,
		Spec:       specBinding,
		Status: osbv1alpha1.SFServiceBindingStatus{
			State: "in_queue",
		},
	}
	getWatchChannel = func(controllerName string) (<-chan event.GenericEvent, error) {
		return watchChannel, nil
	}
}
func TestReconcileMasterClusterBind(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	_getWatchChannel := getWatchChannel
	defer func() {
		getWatchChannel = _getWatchChannel
	}()
	watchChannel := make(chan event.GenericEvent)
	doInitialSetup(watchChannel)
	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	serviceInstance.Spec.ClusterID = "1"
	g.Expect(c.Create(context.TODO(), serviceInstance)).NotTo(gomega.HaveOccurred())

	controller := &BindingReplicator{
		Client:          mgr.GetClient(),
		Log:             ctrlrun.Log.WithName("mcd").WithName("replicator").WithName("binding"),
		clusterRegistry: mockClusterRegistry,
	}
	g.Expect(controller.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
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
	// Get the serviceBinding
	serviceBinding := &osbv1alpha1.SFServiceBinding{}

	// Testing that replication doesn't happen for master cluster
	time.Sleep(timeout)
	g.Eventually(func() error {
		err := c.Get(context.TODO(), bindingKey, serviceBinding)
		if err != nil {
			return err
		}
		if serviceBinding.GetState() != "in_queue" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	defer c.Delete(context.TODO(), serviceInstance)
	defer c.Delete(context.TODO(), serviceBinding)
}

func TestReconcileMultiClusterBind(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	_getWatchChannel := getWatchChannel
	defer func() {
		getWatchChannel = _getWatchChannel
	}()
	watchChannel := make(chan event.GenericEvent)
	doInitialSetup(watchChannel)

	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	serviceInstance.Spec.ClusterID = "2"
	g.Expect(c.Create(context.TODO(), serviceInstance)).NotTo(gomega.HaveOccurred())
	mockClusterRegistry.EXPECT().GetClient("2").Return(c2, nil).AnyTimes()

	controller := &BindingReplicator{
		Client:          mgr.GetClient(),
		Log:             ctrlrun.Log.WithName("mcd").WithName("replicator").WithName("binding"),
		clusterRegistry: mockClusterRegistry,
	}
	g.Expect(controller.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	err = c.Create(context.TODO(), binding)
	if apierrors.IsInvalid(err) {
		t.Logf("failed to create object, got an invalid object error: %v", err)
		return
	}
	g.Expect(err).NotTo(gomega.HaveOccurred())

	serviceBinding := &osbv1alpha1.SFServiceBinding{}
	g.Eventually(func() error {
		err := c.Get(context.TODO(), bindingKey, serviceBinding)
		if err != nil {
			return err
		}
		if serviceBinding.GetState() != "in progress" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	replica := &osbv1alpha1.SFServiceBinding{}
	g.Eventually(func() error {
		err := c2.Get(context.TODO(), bindingKey, replica)
		if err != nil {
			return err
		}
		if replica.GetState() != "in_queue" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		err = c2.Get(context.TODO(), bindingKey, replica)
		if err != nil {
			return err
		}
		replica.SetState("succeeded")
		replica.Status.Response.SecretRef = secretID
		return c2.Update(context.TODO(), replica)
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	replicaSecret := &corev1.Secret{}
	replicaSecret.SetName(secretID)
	replicaSecret.SetNamespace(constants.InteroperatorNamespace)
	err = c2.Create(context.TODO(), replicaSecret)
	g.Expect(err).NotTo(gomega.HaveOccurred())

	watchChannel <- event.GenericEvent{
		Meta:   replica,
		Object: replica,
	}

	g.Eventually(func() error {
		err := c.Get(context.TODO(), bindingKey, serviceBinding)
		if err != nil {
			return err
		}
		if serviceBinding.GetState() != "succeeded" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	bindingSecret := &corev1.Secret{}
	g.Eventually(func() error {
		err := c.Get(context.TODO(), secretKey, bindingSecret)
		if err != nil {
			return err
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(bindingSecret.GetName()).Should(gomega.Equal(secretID))
	defer c.Delete(context.TODO(), serviceInstance)
	defer c.Delete(context.TODO(), serviceBinding)
	defer c.Delete(context.TODO(), bindingSecret)
	defer c2.Delete(context.TODO(), replica)
}

func TestReconcileMultiClusterUnbind(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	_getWatchChannel := getWatchChannel
	defer func() {
		getWatchChannel = _getWatchChannel
	}()
	watchChannel := make(chan event.GenericEvent)
	doInitialSetup(watchChannel)

	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)
	serviceInstance.Spec.ClusterID = "2"
	g.Expect(c.Create(context.TODO(), serviceInstance)).NotTo(gomega.HaveOccurred())

	binding.SetState("succeeded")
	binding.SetFinalizers([]string{"dummy"})
	g.Expect(c.Create(context.TODO(), binding)).NotTo(gomega.HaveOccurred())

	replicaBinding.SetState("succeeded")
	replicaBinding.SetFinalizers([]string{"dummy"})
	g.Expect(c2.Create(context.TODO(), replicaBinding)).NotTo(gomega.HaveOccurred())

	bindingSecret := &corev1.Secret{}
	bindingSecret.SetName(secretID)
	bindingSecret.SetNamespace(constants.InteroperatorNamespace)
	g.Expect(c.Create(context.TODO(), bindingSecret)).NotTo(gomega.HaveOccurred())

	mockClusterRegistry.EXPECT().GetClient("2").Return(c2, nil).AnyTimes()

	controller := &BindingReplicator{
		Client:          mgr.GetClient(),
		Log:             ctrlrun.Log.WithName("mcd").WithName("replicator").WithName("binding"),
		clusterRegistry: mockClusterRegistry,
	}
	g.Expect(controller.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	serviceBinding := &osbv1alpha1.SFServiceBinding{}
	err = c.Get(context.TODO(), bindingKey, serviceBinding)
	g.Expect(err).NotTo(gomega.HaveOccurred())

	err = c.Delete(context.TODO(), serviceBinding)
	g.Expect(err).NotTo(gomega.HaveOccurred())
	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		serviceBinding.SetState("delete")
		err := c.Update(context.TODO(), serviceBinding)
		if err != nil {
			// The binding is possibly outdated, fetch it again and retry the
			// update operation.
			_ = c.Get(context.TODO(), bindingKey, serviceBinding)
			return err
		}
		return nil
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	g.Eventually(func() error {
		err := c.Get(context.TODO(), bindingKey, serviceBinding)
		if err != nil {
			return err
		}
		if serviceBinding.GetState() != "in progress" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	replica := &osbv1alpha1.SFServiceBinding{}
	g.Eventually(func() error {
		err := c2.Get(context.TODO(), bindingKey, replica)
		if err != nil {
			return err
		}
		if replica.GetState() != "delete" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		err = c2.Get(context.TODO(), bindingKey, replica)
		if err != nil {
			return err
		}
		replica.SetState("succeeded")
		labels := make(map[string]string)
		labels[constants.LastOperationKey] = "delete"
		replica.SetLabels(labels)
		return c2.Update(context.TODO(), replica)
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	watchChannel <- event.GenericEvent{
		Meta:   replica,
		Object: replica,
	}

	g.Eventually(func() error {
		err := c.Get(context.TODO(), bindingKey, serviceBinding)
		if err != nil {
			return err
		}
		if replica.GetState() != "succeeded" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	defer c.Delete(context.TODO(), serviceInstance)
	defer c.Delete(context.TODO(), serviceBinding)
	defer c.Delete(context.TODO(), bindingSecret)
	defer c2.Delete(context.TODO(), replica)
}
