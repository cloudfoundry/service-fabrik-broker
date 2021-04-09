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

package sfplan

import (
	"context"
	"fmt"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/onsi/gomega"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var c client.Client

var planKey = types.NamespacedName{Name: "foo", Namespace: constants.InteroperatorNamespace}
var expectedRequest = reconcile.Request{NamespacedName: planKey}

const timeout = time.Second * 5

func TestReconcile(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	templateSpec := []osbv1alpha1.TemplateSpec{
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

	service := &osbv1alpha1.SFService{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "service-id",
			Namespace: constants.InteroperatorNamespace,
			Labels:    map[string]string{"serviceId": "service-id"},
		},
		Spec: osbv1alpha1.SFServiceSpec{
			Name:                 "service-name",
			ID:                   "service-id",
			Description:          "description",
			Tags:                 []string{"foo", "bar"},
			Requires:             []string{"foo", "bar"},
			Bindable:             true,
			InstancesRetrievable: true,
			BindingsRetrievable:  true,
			Metadata:             nil,
			DashboardClient: &osbv1alpha1.DashboardClient{
				ID:          "id",
				Secret:      "secret",
				RedirectURI: "redirecturi",
			},
			PlanUpdatable: true,
			RawContext:    nil,
		},
	}

	instance := &osbv1alpha1.SFPlan{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: constants.InteroperatorNamespace,
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
		},
	}

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c = mgr.GetClient()

	controller := &ReconcileSFPlan{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("provisioners").WithName("plan"),
	}
	g.Expect(controller.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	g.Expect(c.Create(context.TODO(), service)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), service)

	// Create the SFPlan object and expect the Reconcile and Deployment to be created
	err = c.Create(context.TODO(), instance)
	if apierrors.IsInvalid(err) {
		t.Logf("failed to create object, got an invalid object error: %v", err)
		return
	}
	g.Expect(err).NotTo(gomega.HaveOccurred())

	// Get plan
	plan := &osbv1alpha1.SFPlan{}

	// Reconciler add labels
	g.Eventually(func() error {
		err := c.Get(context.TODO(), planKey, plan)
		if err != nil {
			return err
		}
		labels := plan.GetLabels()
		match, err := gomega.HaveKeyWithValue("serviceId", "service-id").Match(labels)
		if err != nil {
			return err
		}
		if !match {
			return fmt.Errorf("label not set")
		}
		match, err = gomega.HaveKeyWithValue("planId", "plan-id").Match(labels)
		if err != nil {
			return err
		}
		if !match {
			return fmt.Errorf("label not set")
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	// Delete the plan
	g.Expect(c.Delete(context.TODO(), instance)).NotTo(gomega.HaveOccurred())

	// Plan should disappear from api server
	g.Eventually(func() error {
		err := c.Get(context.TODO(), planKey, plan)
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil
			}
			return err
		}
		return fmt.Errorf("not deleted")
	}, timeout).Should(gomega.Succeed())
}
