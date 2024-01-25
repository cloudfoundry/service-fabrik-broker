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

package sfservicebindingmetrics

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
	"sigs.k8s.io/controller-runtime/pkg/manager"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"
)

var c, c2 client.Client

var bindingKey = types.NamespacedName{Name: "binding-id", Namespace: "sf-instance-id"}

var instance = &osbv1alpha1.SFServiceInstance{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "instance-id",
		Namespace: "sf-instance-id",
		Labels: map[string]string{
			"state":                    "succeeded",
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
		State: "succeeded",
	},
}

var binding = &osbv1alpha1.SFServiceBinding{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "binding-id",
		Namespace: "sf-instance-id",
	},
	Spec: osbv1alpha1.SFServiceBindingSpec{
		ID:         "binding-id",
		InstanceID: "instance-id",
		PlanID:     "plan-id",
		ServiceID:  "service-id",
	},
	Status: osbv1alpha1.SFServiceBindingStatus{
		State: "update",
	},
}

var binding2 = &osbv1alpha1.SFServiceBinding{}

func TestReconcileSFServiceBindingMetrics(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{
		Metrics: metricsserver.Options{BindAddress: "0"},
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

	controller := &BindingMetrics{
		Client:          mgr.GetClient(),
		Log:             ctrlrun.Log.WithName("mcd").WithName("binding").WithName("metrics"),
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

	// Create Instance
	g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())

	// Create binding
	g.Expect(c.Create(context.TODO(), binding)).NotTo(gomega.HaveOccurred())

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
	var bindingID string
	var creationTimestamp string
	var deletionTimestamp string
	var sfNamespace string
	var metricValue float64

	for stateKey, expectedMetricValue := range testValues {

		binding.SetState(stateKey)
		// Update binding
		g.Expect(c.Update(context.TODO(), binding)).NotTo(gomega.HaveOccurred())

		// Read binding values into var binding2
		c.Get(context.TODO(), bindingKey, binding2)

		bindingID = binding2.GetName()
		state = binding2.GetState()
		instanceID = binding2.Spec.InstanceID
		creationTimestamp = binding2.GetCreationTimestamp().String()
		deletionTimestamp = binding2.GetDeletionTimestampForMetrics()
		sfNamespace = binding2.GetNamespace()

		fmt.Println("state: ", state)
		fmt.Println("Expected Metric Value: ", expectedMetricValue)
		metricValue = testutil.ToFloat64(bindingsMetric.WithLabelValues(bindingID, instanceID, creationTimestamp, deletionTimestamp, state, sfNamespace))
		fmt.Println("Received Metric Value: ", metricValue)
		if float64(expectedMetricValue) != metricValue {
			// Wait for 2 seconds for reconciler to start
			fmt.Println("Waiting for 2 seconds...")
			time.Sleep(2 * time.Second)
			metricValue = testutil.ToFloat64(bindingsMetric.WithLabelValues(bindingID, instanceID, creationTimestamp, deletionTimestamp, state, sfNamespace))
			fmt.Println("Received Metric Value after 2 seconds: ", metricValue)
		}

		g.Expect(metricValue).To(gomega.Equal(float64(expectedMetricValue)))

	}

}
