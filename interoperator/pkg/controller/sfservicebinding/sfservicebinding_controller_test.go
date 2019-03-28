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

package sfservicebinding

import (
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	mock_clusterFactory "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/cluster/factory/mock_factory"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/properties"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/resources/mock_resources"
	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	"golang.org/x/net/context"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var templateSpec = []osbv1alpha1.TemplateSpec{
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

var service = &osbv1alpha1.SFService{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "service-id",
		Namespace: "default",
		Labels:    map[string]string{"serviceId": "service-id"},
	},
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

var plan = &osbv1alpha1.SFPlan{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "plan-id",
		Namespace: "default",
		Labels: map[string]string{
			"serviceId": "service-id",
			"planId":    "plan-id",
		},
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

var c client.Client

var bindingKey = types.NamespacedName{Name: "binding-id", Namespace: "default"}
var expectedRequest = reconcile.Request{NamespacedName: types.NamespacedName{Name: "binding-id", Namespace: "default"}}

const timeout = time.Second * 2

func TestReconcile(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	var expectedResources = []*unstructured.Unstructured{nil}

	var appliedResources = []osbv1alpha1.Source{
		osbv1alpha1.Source{},
	}
	err1 := fmt.Errorf("Some error")

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c = mgr.GetClient()

	mockResourceManager := mock_resources.NewMockResourceManager(ctrl)
	mockClusterFactory := mock_clusterFactory.NewMockClusterFactory(ctrl)
	reconciler := newReconciler(mgr, mockResourceManager, mockClusterFactory)

	mockResourceManager.EXPECT().ComputeExpectedResources(gomock.Any(), "instance-id", "binding-id", "service-id", "plan-id", osbv1alpha1.BindAction, "default").Return(expectedResources, nil).AnyTimes()
	mockResourceManager.EXPECT().SetOwnerReference(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	mockClusterFactory.EXPECT().GetCluster("instance-id", "binding-id", "service-id", "plan-id").Return(reconciler, nil).AnyTimes()
	mockResourceManager.EXPECT().ReconcileResources(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(appliedResources, err1).Times(1)
	mockResourceManager.EXPECT().ReconcileResources(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(appliedResources, nil).AnyTimes()
	mockResourceManager.EXPECT().ComputeStatus(gomock.Any(), gomock.Any(), "instance-id", "binding-id", "service-id", "plan-id", osbv1alpha1.BindAction, "default").Return(&properties.Status{
		Bind: properties.GenericStatus{
			State:    "succeeded",
			Response: "foo",
		},
		Unbind: properties.GenericStatus{
			State: "succeeded",
		},
	}, nil).AnyTimes()
	mockResourceManager.EXPECT().DeleteSubResources(gomock.Any(), gomock.Any()).Return(appliedResources, nil).AnyTimes()

	recFn, requests := SetupTestReconcile(reconciler)
	g.Expect(add(mgr, recFn)).NotTo(gomega.HaveOccurred())

	stopMgr, mgrStopped := StartTestManager(mgr, g)

	logf.SetLogger(logf.ZapLogger(true))

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	// Create the SFServiceBinding object and expect the Reconcile
	err = c.Create(context.TODO(), binding)
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
		if state := serviceBinding.GetState(); state != "succeeded" {
			return fmt.Errorf("state not updated")
		}
		return nil
	}, timeout).Should(gomega.Succeed())
	g.Expect(serviceBinding.Status.State).Should(gomega.Equal("succeeded"))

	secret := &corev1.Secret{}
	secretRef := serviceBinding.Status.Response.SecretRef
	secretKey := types.NamespacedName{Name: secretRef, Namespace: "default"}
	g.Expect(c.Get(context.TODO(), secretKey, secret)).NotTo(gomega.HaveOccurred())
	g.Expect(secret.Data).Should(gomega.HaveKeyWithValue("response", []byte("foo")))

	// Delete the service binding
	g.Expect(c.Delete(context.TODO(), binding)).NotTo(gomega.HaveOccurred())
	g.Expect(drainAllRequests(requests, timeout)).NotTo(gomega.BeZero())
	g.Expect(c.Get(context.TODO(), bindingKey, serviceBinding)).NotTo(gomega.HaveOccurred())
	serviceBinding.SetState("delete")
	g.Expect(c.Update(context.TODO(), serviceBinding)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Delete(context.TODO(), secret)).NotTo(gomega.HaveOccurred())

	g.Expect(drainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	// Binding should disappear from api server
	g.Eventually(func() error {
		err := c.Get(context.TODO(), bindingKey, serviceBinding)
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
	select {
	case <-requests:
		return 1 + drainAllRequests(requests, remainingTime)
	case <-time.After(remainingTime):
		return 0
	}
}

func TestReconcileSFServiceBinding_handleError(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c := mgr.GetClient()
	mockResourceManager := mock_resources.NewMockResourceManager(ctrl)
	mockClusterFactory := mock_clusterFactory.NewMockClusterFactory(ctrl)
	stopMgr, mgrStopped := StartTestManager(mgr, g)
	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()
	cache := mgr.GetCache()

	binding := &osbv1alpha1.SFServiceBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "binding-id",
			Namespace: "default",
			Labels: map[string]string{
				"state":                 "in_queue",
				constants.ErrorCountKey: "10",
			},
			Finalizers: []string{"abc"},
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
	err = c.Create(context.TODO(), binding)
	g.Expect(err).NotTo(gomega.HaveOccurred())
	serviceBinding := &osbv1alpha1.SFServiceBinding{}
	g.Eventually(func() error {
		return c.Get(context.TODO(), bindingKey, serviceBinding)
	}, timeout).Should(gomega.Succeed())

	r := &ReconcileSFServiceBinding{
		Client:          c,
		scheme:          mgr.GetScheme(),
		clusterFactory:  mockClusterFactory,
		resourceManager: mockResourceManager,
	}
	type args struct {
		object        *osbv1alpha1.SFServiceBinding
		result        reconcile.Result
		inputErr      error
		lastOperation string
		retryCount    int
	}
	tests := []struct {
		name    string
		setup   func()
		args    args
		want    reconcile.Result
		wantErr bool
	}{
		{
			name: "ignore error if retry count is reached",
			args: args{
				object:        binding,
				result:        reconcile.Result{},
				inputErr:      errors.NewMarshalError("", nil),
				lastOperation: "in_queue",
				retryCount:    0,
			},
			want:    reconcile.Result{},
			wantErr: false,
		},
		{
			name: "delete binding if instance not found",
			args: args{
				object:        binding,
				result:        reconcile.Result{},
				inputErr:      errors.NewSFServiceInstanceNotFound("instance-id", nil),
				lastOperation: "in_queue",
				retryCount:    0,
			},
			want:    reconcile.Result{},
			wantErr: false,
		},
		{
			name: "return error if binding not found",
			setup: func() {
				stopCacheSync := make(chan struct{})
				g.Expect(cache.WaitForCacheSync(stopCacheSync)).To(gomega.BeTrue())
				g.Eventually(func() error {
					return c.Get(context.TODO(), bindingKey, serviceBinding)
				}, timeout).Should(gomega.Succeed())
				serviceBinding.SetFinalizers([]string{})
				g.Expect(c.Update(context.TODO(), serviceBinding)).NotTo(gomega.HaveOccurred())
				g.Eventually(func() error {
					err := c.Get(context.TODO(), bindingKey, serviceBinding)
					if err != nil {
						return nil
					}
					return errors.NewMarshalError("", nil)
				}, timeout).Should(gomega.Succeed())
			},
			args: args{
				object:        binding,
				result:        reconcile.Result{},
				inputErr:      errors.NewMarshalError("", nil),
				lastOperation: "in_queue",
				retryCount:    0,
			},
			want:    reconcile.Result{},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			got, err := r.handleError(tt.args.object, tt.args.result, tt.args.inputErr, tt.args.lastOperation, tt.args.retryCount)
			if (err != nil) != tt.wantErr {
				t.Errorf("ReconcileSFServiceBinding.handleError() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ReconcileSFServiceBinding.handleError() = %v, want %v", got, tt.want)
			}
		})
	}
}
