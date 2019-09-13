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

package provisioner

import (
	"context"
	"testing"
	"time"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/resource/v1alpha1"
	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/provisioner/mock_provisioner"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	v1 "k8s.io/api/rbac/v1"
	apiextensionsv1beta1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1beta1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
)

var c client.Client

var expectedRequest = reconcile.Request{NamespacedName: types.NamespacedName{Name: "1", Namespace: "default"}}

const timeout = time.Second * 5

// var expectedRequest = reconcile.Request{NamespacedName: "1"}

var clusterInstance = &resourcev1alpha1.SFCluster{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "2",
		Namespace: "default",
	},
	Spec: resourcev1alpha1.SFClusterSpec{
		SecretRef: "my-secret",
	},
}

var clusterSecret = &corev1.Secret{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "my-secret",
		Namespace: "default",
	},
}

var statefulSetInstance = &appsv1.StatefulSet{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "provisioner",
		Namespace: "default",
	},
	Spec: appsv1.StatefulSetSpec{
		Selector: &metav1.LabelSelector{},
		Template: corev1.PodTemplateSpec{
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{
						Name: "my-container",
					},
				},
			},
		},
	},
}

func TestReconcile(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c = mgr.GetClient()
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	mockProvisioner := mock_provisioner.NewMockProvisioner(ctrl)
	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	targetReconciler := &ReconcileProvisioner{
		Client:          c2,
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
		provisioner:     mockProvisioner,
	}

	reconciler := newReconciler(mgr, mockClusterRegistry, mockProvisioner)

	_addClusterToWatch := addClusterToWatch
	defer func() {
		addClusterToWatch = _addClusterToWatch
	}()
	addClusterToWatch = func(string) error {
		return nil
	}

	_removeClusterFromWatch := removeClusterFromWatch
	defer func() {
		removeClusterFromWatch = _removeClusterFromWatch
	}()
	removeClusterFromWatch = func(string) error {
		return nil
	}

	// Create cluster secret in master cluster
	clusterSecret.Data = make(map[string][]byte)
	clusterSecret.Data["foo"] = []byte("bar")
	c.Create(context.TODO(), clusterSecret)

	// create provisioner statefulset in master cluster

	labels := make(map[string]string)
	labels["foo"] = "bar"
	statefulSetInstance.Spec.Template.SetLabels(labels)
	statefulSetInstance.Spec.Selector.MatchLabels = labels
	c.Create(context.TODO(), statefulSetInstance)

	mockClusterRegistry.EXPECT().GetClient("2").Return(targetReconciler, nil).AnyTimes()
	mockProvisioner.EXPECT().GetStatefulSet().Return(statefulSetInstance, nil).Times(1)

	recFn, requests := SetupTestReconcile(reconciler)
	g.Expect(add(mgr, recFn)).NotTo(gomega.HaveOccurred())
	defer close(StartTestManager(mgr, g))

	// Create SFCluster
	err = c.Create(context.TODO(), clusterInstance)
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

	// Delete SFCluster
	c.Delete(context.TODO(), clusterInstance)
	g.Expect(utils.DrainAllRequests(requests, timeout)).NotTo(gomega.BeZero())

}

func TestReconcileProvisioner_registerSFCrds(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})

	mockProvisioner := mock_provisioner.NewMockProvisioner(ctrl)
	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	// Delete CRDs
	sfcrdnames := []string{
		"sfplans.osb.servicefabrik.io",
		"sfservices.osb.servicefabrik.io",
		"sfserviceinstances.osb.servicefabrik.io",
		"sfservicebindings.osb.servicefabrik.io",
		"sfclusters.resource.servicefabrik.io",
	}
	for _, sfcrdname := range sfcrdnames {
		sfCRDInstance := &apiextensionsv1beta1.CustomResourceDefinition{}
		err = c2.Get(context.TODO(), types.NamespacedName{Name: sfcrdname}, sfCRDInstance)
		c2.Delete(context.TODO(), sfCRDInstance)
	}

	r := &ReconcileProvisioner{
		Client:          c,
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
		provisioner:     mockProvisioner,
	}
	type args struct {
		clusterID    string
		targetClient client.Client
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		{
			name: "Register CRDs if Not Present",
			args: args{
				clusterID:    "2",
				targetClient: c2,
			},
			wantErr: false,
		},
		{
			name: "Update CRDs if already exists",
			args: args{
				clusterID:    "2",
				targetClient: c2,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := r.registerSFCrds(tt.args.clusterID, tt.args.targetClient); (err != nil) != tt.wantErr {
				t.Errorf("ReconcileProvisioner.registerSFCrds() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
		sfcrdnames := []string{
			"sfplans.osb.servicefabrik.io",
			"sfservices.osb.servicefabrik.io",
			"sfserviceinstances.osb.servicefabrik.io",
			"sfservicebindings.osb.servicefabrik.io",
			"sfclusters.resource.servicefabrik.io",
		}
		for _, sfcrdname := range sfcrdnames {
			sfCRDInstance := &apiextensionsv1beta1.CustomResourceDefinition{}
			g.Expect(c2.Get(context.TODO(), types.NamespacedName{Name: sfcrdname}, sfCRDInstance)).NotTo(gomega.HaveOccurred())

		}
	}
}

func TestReconcileProvisioner_reconcileNamespace(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})

	mockProvisioner := mock_provisioner.NewMockProvisioner(ctrl)
	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	r := &ReconcileProvisioner{
		Client:          c,
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
		provisioner:     mockProvisioner,
	}

	type args struct {
		namespace    string
		clusterID    string
		targetClient client.Client
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		{
			name: "Success if Namespace already exists",
			args: args{
				namespace:    "test-namespace",
				clusterID:    "2",
				targetClient: c2,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := r.reconcileNamespace(tt.args.namespace, tt.args.clusterID, tt.args.targetClient); (err != nil) != tt.wantErr {
				t.Errorf("ReconcileProvisioner.reconcileNamespace() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
		ns := &corev1.Namespace{}
		g.Expect(c2.Get(context.TODO(), types.NamespacedName{
			Name: "test-namespace",
		}, ns)).NotTo(gomega.HaveOccurred())
	}
}

func TestReconcileProvisioner_reconcileSfClusterCrd(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})

	// Delete sfcluster from target cluster
	sfTargetCluster := &resourcev1alpha1.SFCluster{}
	err = c2.Get(context.TODO(), types.NamespacedName{Name: "2", Namespace: "default"}, sfTargetCluster)
	if err == nil {
		c2.Delete(context.TODO(), sfTargetCluster)
	}

	mockProvisioner := mock_provisioner.NewMockProvisioner(ctrl)
	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	r := &ReconcileProvisioner{
		Client:          c,
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
		provisioner:     mockProvisioner,
	}

	type args struct {
		clusterInstance *resourcev1alpha1.SFCluster
		clusterID       string
		targetClient    client.Client
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		{
			name: "Create if SFCluster not found",
			args: args{
				clusterInstance: clusterInstance,
				clusterID:       "2",
				targetClient:    c2,
			},
			wantErr: false,
		},
		{
			name: "Update if SFCluster already exists",
			args: args{
				clusterInstance: clusterInstance,
				clusterID:       "2",
				targetClient:    c2,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := r.reconcileSfClusterCrd(tt.args.clusterInstance, tt.args.clusterID, tt.args.targetClient); (err != nil) != tt.wantErr {
				t.Errorf("ReconcileProvisioner.reconcileSfClusterCrd() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
		sfTargetCluster := &resourcev1alpha1.SFCluster{}
		g.Expect(c2.Get(context.TODO(), types.NamespacedName{Name: "2", Namespace: "default"}, sfTargetCluster)).NotTo(gomega.HaveOccurred())
	}
}

func TestReconcileProvisioner_reconcileSfClusterSecret(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})

	// Delete sfcluster from target cluster
	clusterInstanceSecret := &corev1.Secret{}
	err = c2.Get(context.TODO(), types.NamespacedName{Name: "my-secret", Namespace: "default"}, clusterInstanceSecret)
	if err == nil {
		c2.Delete(context.TODO(), clusterInstanceSecret)
	}

	clusterSecret.Data = make(map[string][]byte)
	clusterSecret.Data["foo"] = []byte("bar")
	c.Create(context.TODO(), clusterSecret)

	mockProvisioner := mock_provisioner.NewMockProvisioner(ctrl)
	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	r := &ReconcileProvisioner{
		Client:          c,
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
		provisioner:     mockProvisioner,
	}

	type args struct {
		namespace    string
		secretName   string
		clusterID    string
		targetClient client.Client
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		{
			name: "Create if Secret not found",
			args: args{
				namespace:    "default",
				secretName:   "my-secret",
				clusterID:    "2",
				targetClient: c2,
			},
			wantErr: false,
		},
		{
			name: "Update if secret already exists",
			args: args{
				namespace:    "default",
				secretName:   "my-secret",
				clusterID:    "2",
				targetClient: c2,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := r.reconcileSfClusterSecret(tt.args.namespace, tt.args.secretName, tt.args.clusterID, tt.args.targetClient); (err != nil) != tt.wantErr {
				t.Errorf("ReconcileProvisioner.reconcileSfClusterSecret() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
		clusterInstanceSecret := &corev1.Secret{}
		g.Expect(c2.Get(context.TODO(), types.NamespacedName{Name: "my-secret", Namespace: "default"}, clusterInstanceSecret)).NotTo(gomega.HaveOccurred())
	}
}

func TestReconcileProvisioner_reconcileStatefulSet(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})

	// Delete provisioner statefulset in target cluster if present

	targetProvisionerInstance := &appsv1.StatefulSet{}
	err = c2.Get(context.TODO(), types.NamespacedName{Name: "provisioner", Namespace: "default"}, targetProvisionerInstance)
	if err == nil {
		c2.Delete(context.TODO(), targetProvisionerInstance)
	}

	// Create provisioner stateful set in master cluster

	labels := make(map[string]string)
	labels["foo"] = "bar"
	statefulSetInstance.Spec.Template.SetLabels(labels)
	statefulSetInstance.Spec.Selector.MatchLabels = labels
	c.Create(context.TODO(), statefulSetInstance)

	mockProvisioner := mock_provisioner.NewMockProvisioner(ctrl)
	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	r := &ReconcileProvisioner{
		Client:          c,
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
		provisioner:     mockProvisioner,
	}

	type args struct {
		statefulSetInstance *appsv1.StatefulSet
		clusterID           string
		targetClient        client.Client
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		{
			name: "Create if provisioner does not exists",
			args: args{
				statefulSetInstance: statefulSetInstance,
				clusterID:           "2",
				targetClient:        c2,
			},
			wantErr: false,
		},
		{
			name: "Update if provisioner already exists",
			args: args{
				statefulSetInstance: statefulSetInstance,
				clusterID:           "2",
				targetClient:        c2,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := r.reconcileStatefulSet(tt.args.statefulSetInstance, tt.args.clusterID, tt.args.targetClient); (err != nil) != tt.wantErr {
				t.Errorf("ReconcileProvisioner.reconcileStatefulSet() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
		targetProvisionerInstance := &appsv1.StatefulSet{}
		g.Expect(c2.Get(context.TODO(), types.NamespacedName{Name: "provisioner", Namespace: "default"}, targetProvisionerInstance)).NotTo(gomega.HaveOccurred())
	}
}

func TestReconcileProvisioner_reconcileClusterRoleBinding(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})

	// Delete clusterrolebinding in target cluster if present

	targetClusterRoleBinding := &v1.ClusterRoleBinding{}
	err = c2.Get(context.TODO(), types.NamespacedName{Name: "provisioner-clusterrolebinding", Namespace: "default"}, targetClusterRoleBinding)
	if err == nil {
		c2.Delete(context.TODO(), targetClusterRoleBinding)
	}

	mockProvisioner := mock_provisioner.NewMockProvisioner(ctrl)
	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	r := &ReconcileProvisioner{
		Client:          c,
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
		provisioner:     mockProvisioner,
	}

	type args struct {
		namespace    string
		clusterID    string
		targetClient client.Client
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		{
			name: "Create if clusterrolebinding does not exists",
			args: args{
				namespace:    "default",
				clusterID:    "2",
				targetClient: c2,
			},
			wantErr: false,
		},
		{
			name: "Update if clusterrolebinding already exists",
			args: args{
				namespace:    "default",
				clusterID:    "2",
				targetClient: c2,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := r.reconcileClusterRoleBinding(tt.args.namespace, tt.args.clusterID, tt.args.targetClient); (err != nil) != tt.wantErr {
				t.Errorf("ReconcileProvisioner.reconcileClusterRoleBinding() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
		targetClusterRoleBinding := &v1.ClusterRoleBinding{}
		g.Expect(c2.Get(context.TODO(), types.NamespacedName{Name: "provisioner-clusterrolebinding", Namespace: "default"}, targetClusterRoleBinding)).NotTo(gomega.HaveOccurred())
	}
}
