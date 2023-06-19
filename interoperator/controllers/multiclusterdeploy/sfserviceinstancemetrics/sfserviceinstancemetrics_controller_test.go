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
	//"context"
	//"fmt"
	"testing"
	//"time"

	//osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"
	//"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	//corev1 "k8s.io/api/core/v1"
	//apierrors "k8s.io/apimachinery/pkg/api/errors"
	//metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	//"k8s.io/apimachinery/pkg/types"
	//"k8s.io/client-go/util/retry"
	ctrlrun "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	//"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var c client.Client

//var expectedRequest = reconcile.Request{NamespacedName: types.NamespacedName{Name: "foo", Namespace: constants.InteroperatorNamespace}}
//var instanceKey = types.NamespacedName{Name: "instance-id", Namespace: "sf-instance-id"}
//var serviceKey = types.NamespacedName{Name: "service-id", Namespace: constants.InteroperatorNamespace}
//var planKey = types.NamespacedName{Name: "plan-id", Namespace: constants.InteroperatorNamespace}

//const timeout = time.Second * 5

/*var instance = &osbv1alpha1.SFServiceInstance{
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
		State: "in_progress",
	},
}*/

func TestReconcile(t *testing.T) {
	//instance2 := &osbv1alpha1.SFServiceInstance{}
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

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)
	mockClusterRegistry.EXPECT().GetClient("2").Return(c, nil).AnyTimes()

	controller := &InstanceMetrics{
		Client:          mgr.GetClient(),
		Log:             ctrlrun.Log.WithName("mcd").WithName("metrics").WithName("instance"),
		clusterRegistry: mockClusterRegistry,
	}
	g.Expect(controller.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
	cancelMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		cancelMgr()
		mgrStopped.Wait()
	}()

}
