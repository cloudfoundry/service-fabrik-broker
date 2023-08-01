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

package sfserviceinstancemetrics

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
	"github.com/prometheus/client_golang/prometheus/testutil"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	ctrlrun "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/manager"
)

var c, c2 client.Client
var instanceKey = types.NamespacedName{Name: "instance-id", Namespace: "sf-instance-id"}

const timeout = time.Second * 5

var instance = &osbv1alpha1.SFServiceInstance{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "instance-id",
		Namespace: "sf-instance-id",
		Labels: map[string]string{
			"state":                    "delete",
			constants.LastOperationKey: "create",
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
		State: "delete",
	},
}

// Create instance2 empty var for validation
// To fetch the values of instance for validation
var instance2 = &osbv1alpha1.SFServiceInstance{}

func TestReconcileSFServiceInstanceMetrics(t *testing.T) {
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

	controller := &InstanceMetrics{
		Client:          mgr.GetClient(),
		Log:             ctrlrun.Log.WithName("mcd").WithName("instance").WithName("metrics"),
		clusterRegistry: mockClusterRegistry,
	}
	g.Expect(controller.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
	cancelMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		cancelMgr()
		mgrStopped.Wait()
	}()

	// Create a new namespace
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name: "sf-instance-id",
		},
	}
	g.Expect(c.Create(context.TODO(), ns)).NotTo(gomega.HaveOccurred())

	// Create instance
	g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())

	testValues := map[string]int{
		"succeeded":   0,
		"failed":      1,
		"in progress": 2,
		"in_queue":    3,
		"update":      3,
		"delete":      3,
	}

	var instanceID string
	var state string
	var creationTimestamp string
	var deletionTimestamp string
	var serviceId string
	var planId string
	var organizationGuid string
	var spaceGuid string
	var sfNamespace string
	var lastOperation string
	var metricValue float64

	for stateKey, expectedMetricValue := range testValues {

		instance.SetState(stateKey)
		// Update instance
		g.Expect(c.Update(context.TODO(), instance)).NotTo(gomega.HaveOccurred())

		// Read instance values into var instance2
		c.Get(context.TODO(), instanceKey, instance2)

		instanceID = instance2.GetName()
		state = instance2.GetState()
		creationTimestamp = instance2.GetCreationTimestamp().String()
		deletionTimestamp = instance2.GetDeletionTimestampForMetrics()
		serviceId = instance2.Spec.ServiceID
		planId = instance2.Spec.PlanID
		organizationGuid = instance2.Spec.OrganizationGUID
		spaceGuid = instance2.Spec.SpaceGUID
		sfNamespace = instance2.GetNamespace()
		lastOperation = instance2.GetLastOperation()

		fmt.Println("state: ", state)
		fmt.Println("Expected Metric Value: ", expectedMetricValue)
		metricValue = testutil.ToFloat64(instancesMetric.WithLabelValues(instanceID, state, creationTimestamp, deletionTimestamp, serviceId, planId, organizationGuid, spaceGuid, sfNamespace, lastOperation))
		fmt.Println("Received Metric Value: ", metricValue)
		if float64(expectedMetricValue) != metricValue {
			// Wait for 2 seconds for reconciler to start
			fmt.Println("Waiting for 2 seconds...")
			time.Sleep(2 * time.Second)
			metricValue = testutil.ToFloat64(instancesMetric.WithLabelValues(instanceID, state, creationTimestamp, deletionTimestamp, serviceId, planId, organizationGuid, spaceGuid, sfNamespace, lastOperation))
			fmt.Println("Received Metric Value after 2 seconds: ", metricValue)
		}
		g.Expect(metricValue).To(gomega.Equal(float64(expectedMetricValue)))

	}

}
