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

package sfservice

import (
	"fmt"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/onsi/gomega"
	"golang.org/x/net/context"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var c client.Client

var serviceKey = types.NamespacedName{Name: "service-id", Namespace: "default"}
var expectedRequest = reconcile.Request{NamespacedName: serviceKey}

const timeout = time.Second * 5

func TestReconcile(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	instance := &osbv1alpha1.SFService{
		ObjectMeta: metav1.ObjectMeta{Name: "service-id", Namespace: "default"},
		Spec: osbv1alpha1.SFServiceSpec{
			Name:                "service-name",
			ID:                  "service-id",
			Description:         "description",
			Tags:                []string{"foo", "bar"},
			Requires:            []string{"foo", "bar"},
			Bindable:            true,
			InstanceRetrievable: true,
			BindingRetrievable:  true,
			Metadata:            nil,
			DashboardClient: osbv1alpha1.DashboardClient{
				ID:          "id",
				Secret:      "secret",
				RedirectURI: "redirecturi",
			},
			PlanUpdatable: true,
			RawContext:    nil,
		},
	}

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c = mgr.GetClient()

	recFn, requests := SetupTestReconcile(newReconciler(mgr))
	g.Expect(add(mgr, recFn)).NotTo(gomega.HaveOccurred())
	defer func() {
		// Drain all requests
		for len(requests) > 0 {
			<-requests
			if len(requests) == 0 {
				time.Sleep(2 * time.Second)
			}
		}
	}()

	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	// Create the SFService object and expect the Reconcile and Deployment to be created
	err = c.Create(context.TODO(), instance)
	if apierrors.IsInvalid(err) {
		t.Logf("failed to create object, got an invalid object error: %v", err)
		return
	}
	g.Expect(err).NotTo(gomega.HaveOccurred())

	// Get the service
	service := &osbv1alpha1.SFService{}

	// Reconciler add labels
	g.Expect(drainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	// Verify the labels are present
	g.Eventually(func() error { return c.Get(context.TODO(), serviceKey, service) }, timeout).
		Should(gomega.Succeed())
	labels := service.GetLabels()
	g.Expect(labels).Should(gomega.HaveKeyWithValue("serviceId", "service-id"))

	// Delete the service
	g.Expect(c.Delete(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(drainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	// Service should disappear from api server
	g.Eventually(func() error {
		err := c.Get(context.TODO(), serviceKey, service)
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil
			}
			return err
		}
		return fmt.Errorf("not deleted")
	}, timeout).Should(gomega.Succeed())
}

func drainAllRequests(requests <-chan reconcile.Request, remainingTime time.Duration) int {
	// Drain all requests
	start := time.Now()
	select {
	case <-requests:
		diff := time.Now().Sub(start)
		if diff < remainingTime {
			return 1 + drainAllRequests(requests, remainingTime-diff)
		}
		return 1
	case <-time.After(remainingTime):
		return 0
	}
}
