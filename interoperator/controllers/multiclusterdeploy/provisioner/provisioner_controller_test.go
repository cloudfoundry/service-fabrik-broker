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
	"fmt"
	"testing"
	"time"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/golang/mock/gomock"
	"github.com/onsi/gomega"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	v1 "k8s.io/api/rbac/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	ctrlrun "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
)

var c client.Client

var expectedRequest = ctrlrun.Request{NamespacedName: types.NamespacedName{Name: "1", Namespace: constants.InteroperatorNamespace}}

const timeout = time.Second * 5

// var expectedRequest = reconcile.Request{NamespacedName: "1"}

var clusterInstance = &resourcev1alpha1.SFCluster{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "2",
		Namespace: constants.InteroperatorNamespace,
	},
	Spec: resourcev1alpha1.SFClusterSpec{
		SecretRef: "my-secret",
	},
}

var clusterSecret = &corev1.Secret{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "my-secret",
		Namespace: constants.InteroperatorNamespace,
	},
}

var deploymentInstance = &appsv1.Deployment{
	ObjectMeta: metav1.ObjectMeta{
		Name:      "provisioner",
		Namespace: constants.InteroperatorNamespace,
	},
	Spec: appsv1.DeploymentSpec{
		Selector: &metav1.LabelSelector{},
		Template: corev1.PodTemplateSpec{
			Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{
						Name:  "my-container",
						Image: "foo",
					},
				},
				ImagePullSecrets: []corev1.LocalObjectReference{
					{
						Name: "my-secret",
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
	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c = mgr.GetClient()
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	targetReconciler := &ReconcileProvisioner{
		Client:          c2,
		Log:             ctrlrun.Log.WithName("mcd").WithName("provisioner"),
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
	}

	controller := &ReconcileProvisioner{
		Client:          mgr.GetClient(),
		Log:             ctrlrun.Log.WithName("mcd").WithName("provisioner"),
		clusterRegistry: mockClusterRegistry,
	}

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
	g.Expect(c.Create(context.TODO(), clusterSecret)).NotTo(gomega.HaveOccurred())

	// create provisioner deployment in master cluster

	labels := make(map[string]string)
	labels["foo"] = "bar"
	deploymentInstance.Spec.Template.SetLabels(labels)
	deploymentInstance.Spec.Selector.MatchLabels = labels
	g.Expect(c.Create(context.TODO(), deploymentInstance)).NotTo(gomega.HaveOccurred())

	mockClusterRegistry.EXPECT().GetClient("2").Return(targetReconciler, nil).AnyTimes()

	g.Expect(controller.SetupWithManager(mgr)).NotTo(gomega.HaveOccurred())
	stopMgr, mgrStopped := StartTestManager(mgr, g)

	defer func() {
		close(stopMgr)
		mgrStopped.Wait()
	}()

	// Create SFCluster
	g.Expect(c.Create(context.TODO(), clusterInstance)).NotTo(gomega.HaveOccurred())

	provisionerInstance := &appsv1.Deployment{}
	g.Eventually(func() error {
		err := targetReconciler.Get(context.TODO(), types.NamespacedName{
			Name:      deploymentInstance.GetName(),
			Namespace: deploymentInstance.GetNamespace(),
		}, provisionerInstance)
		if err != nil {
			return err
		}
		return nil
	}, timeout).Should(gomega.Succeed())

	// Delete SFCluster
	g.Expect(c.Delete(context.TODO(), clusterInstance)).NotTo(gomega.HaveOccurred())
	g.Eventually(func() error {
		err := c.Get(context.TODO(), types.NamespacedName{
			Name:      clusterInstance.GetName(),
			Namespace: clusterInstance.GetNamespace(),
		}, clusterInstance)
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil
			}
			return err
		}
		return fmt.Errorf("not deleted")
	}, timeout).Should(gomega.Succeed())

	// Delete SFCluster from target
	g.Expect(targetReconciler.Delete(context.TODO(), clusterInstance)).NotTo(gomega.HaveOccurred())
	g.Eventually(func() error {
		err := targetReconciler.Get(context.TODO(), types.NamespacedName{
			Name:      clusterInstance.GetName(),
			Namespace: clusterInstance.GetNamespace(),
		}, clusterInstance)
		if err != nil {
			if apierrors.IsNotFound(err) {
				return nil
			}
			return err
		}
		return fmt.Errorf("not deleted")
	}, timeout).Should(gomega.Succeed())

}

func TestReconcileProvisioner_registerSFCrds(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
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

	// Delete CRDs
	sfcrdnames := []string{
		"sfplans.osb.servicefabrik.io",
		"sfservices.osb.servicefabrik.io",
		"sfserviceinstances.osb.servicefabrik.io",
		"sfservicebindings.osb.servicefabrik.io",
		"sfclusters.resource.servicefabrik.io",
	}
	for _, sfcrdname := range sfcrdnames {
		sfCRDInstance := &apiextensionsv1.CustomResourceDefinition{}
		err = c2.Get(context.TODO(), types.NamespacedName{Name: sfcrdname}, sfCRDInstance)
		g.Expect(err).NotTo(gomega.HaveOccurred())
		c2.Delete(context.TODO(), sfCRDInstance)
	}

	r := &ReconcileProvisioner{
		Client:          c,
		Log:             ctrlrun.Log.WithName("mcd").WithName("provisioner"),
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
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
		time.Sleep(time.Second * 2)
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
			sfCRDInstance := &apiextensionsv1.CustomResourceDefinition{}
			g.Eventually(func() error {
				return c2.Get(context.TODO(), types.NamespacedName{Name: sfcrdname}, sfCRDInstance)
			}, timeout).Should(gomega.Succeed())
		}
	}
}

func TestReconcileProvisioner_reconcilePrimaryClusterIDConfig(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

	// Setup the Manager and Controller.  Wrap the Controller Reconcile function so it writes each request to a
	// channel when it is finished.
	mgr, err := manager.New(cfg, manager.Options{
		MetricsBindAddress: "0",
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	g.Expect(err).NotTo(gomega.HaveOccurred())
	c, err = client.New(cfg, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)
	data := make(map[string]string)
	configData := `
instanceWorkerCount: 2
instanceContollerWatchList:
- apiVersion: kubedb.com/v1alpha1
  kind: Postgres
- apiVersion: kubernetes.sapcloud.io/v1alpha1
  kind: Postgresql
- apiVersion: deployment.servicefabrik.io/v1alpha1
  kind: Director`
	data[constants.ConfigMapKey] = configData
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      constants.ConfigMapName,
			Namespace: constants.InteroperatorNamespace,
		},
		Data: data,
	}
	g.Expect(c.Create(context.TODO(), configMap)).NotTo(gomega.HaveOccurred())
	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	g.Expect(err).NotTo(gomega.HaveOccurred())

	r := &ReconcileProvisioner{
		Client:          c,
		Log:             ctrlrun.Log.WithName("mcd").WithName("provisioner"),
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
		cfgManager:      cfgManager,
	}
	// Set primaryClusterId to a dummy value in config and verify it gets reconciled
	interoperatorCfg := cfgManager.GetConfig()
	interoperatorCfg.PrimaryClusterID = "dummy"
	g.Expect(r.cfgManager.UpdateConfig(interoperatorCfg)).NotTo(gomega.HaveOccurred())
	var primaryClusterInstance = &resourcev1alpha1.SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "primary",
			Namespace: constants.InteroperatorNamespace,
		},
		Spec: resourcev1alpha1.SFClusterSpec{
			SecretRef: "my-secret",
		},
	}
	labels := make(map[string]string)
	labels[constants.PrimaryClusterKey] = "true"
	primaryClusterInstance.SetLabels(labels)
	g.Expect(c.Create(context.TODO(), primaryClusterInstance)).NotTo(gomega.HaveOccurred())
	err = r.reconcilePrimaryClusterIDConfig()
	g.Expect(err).NotTo(gomega.HaveOccurred())
	interoperatorCfg = cfgManager.GetConfig()
	g.Expect(interoperatorCfg.PrimaryClusterID).To(gomega.Equal("primary"))
}

func TestReconcileProvisioner_reconcileNamespace(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

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
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	r := &ReconcileProvisioner{
		Client:          c,
		Log:             ctrlrun.Log.WithName("mcd").WithName("provisioner"),
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
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
		g.Eventually(func() error {
			return c2.Get(context.TODO(), types.NamespacedName{
				Name: "test-namespace",
			}, ns)
		}, timeout).Should(gomega.Succeed())
	}
}

func TestReconcileProvisioner_reconcileSfClusterCrd(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

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
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	// Delete sfcluster from target cluster
	sfTargetCluster := &resourcev1alpha1.SFCluster{}
	err = c2.Get(context.TODO(), types.NamespacedName{Name: "2", Namespace: constants.InteroperatorNamespace}, sfTargetCluster)
	if err == nil {
		c2.Delete(context.TODO(), sfTargetCluster)
	}

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	r := &ReconcileProvisioner{
		Client:          c,
		Log:             ctrlrun.Log.WithName("mcd").WithName("provisioner"),
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
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
		g.Eventually(func() error {
			return c2.Get(context.TODO(), types.NamespacedName{Name: "2", Namespace: constants.InteroperatorNamespace}, sfTargetCluster)
		}, timeout).Should(gomega.Succeed())
	}
}

func TestReconcileProvisioner_reconcileSecret(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

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
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	// Delete sfcluster from target cluster
	clusterInstanceSecret := &corev1.Secret{}
	err = c2.Get(context.TODO(), types.NamespacedName{Name: "my-secret", Namespace: constants.InteroperatorNamespace}, clusterInstanceSecret)
	if err == nil {
		c2.Delete(context.TODO(), clusterInstanceSecret)
	}

	clusterSecret.Data = make(map[string][]byte)
	clusterSecret.Data["foo"] = []byte("bar")
	c.Create(context.TODO(), clusterSecret)

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	r := &ReconcileProvisioner{
		Client:          c,
		Log:             ctrlrun.Log.WithName("mcd").WithName("provisioner"),
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
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
				namespace:    constants.InteroperatorNamespace,
				secretName:   "my-secret",
				clusterID:    "2",
				targetClient: c2,
			},
			wantErr: false,
		},
		{
			name: "Update if secret already exists",
			args: args{
				namespace:    constants.InteroperatorNamespace,
				secretName:   "my-secret",
				clusterID:    "2",
				targetClient: c2,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := r.reconcileSecret(tt.args.namespace, tt.args.secretName, tt.args.clusterID, tt.args.targetClient); (err != nil) != tt.wantErr {
				t.Errorf("ReconcileProvisioner.reconcileSfClusterSecret() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
		clusterInstanceSecret := &corev1.Secret{}
		g.Eventually(func() error {
			return c2.Get(context.TODO(), types.NamespacedName{Name: "my-secret", Namespace: constants.InteroperatorNamespace}, clusterInstanceSecret)
		}, timeout).Should(gomega.Succeed())
	}
}

func TestReconcileProvisioner_reconcileDeployment(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

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
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
	// Delete provisioner deployment in target cluster if present

	targetProvisionerInstance := &appsv1.Deployment{}
	err = c2.Get(context.TODO(), types.NamespacedName{Name: "provisioner", Namespace: constants.InteroperatorNamespace}, targetProvisionerInstance)
	if err == nil {
		c2.Delete(context.TODO(), targetProvisionerInstance)
	}

	// Create provisioner stateful set in master cluster

	labels := make(map[string]string)
	labels["foo"] = "bar"
	deploymentInstance.Spec.Template.SetLabels(labels)
	deploymentInstance.Spec.Selector.MatchLabels = labels
	c.Create(context.TODO(), deploymentInstance)

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	r := &ReconcileProvisioner{
		Client:          c,
		Log:             ctrlrun.Log.WithName("mcd").WithName("provisioner"),
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
	}

	type args struct {
		deploymentInstance *appsv1.Deployment
		clusterID          string
		targetClient       client.Client
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		{
			name: "Create if provisioner does not exists",
			args: args{
				deploymentInstance: deploymentInstance,
				clusterID:          "2",
				targetClient:       c2,
			},
			wantErr: false,
		},
		{
			name: "Update if provisioner already exists",
			args: args{
				deploymentInstance: deploymentInstance,
				clusterID:          "2",
				targetClient:       c2,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := r.reconcileDeployment(tt.args.deploymentInstance, tt.args.clusterID, tt.args.targetClient); (err != nil) != tt.wantErr {
				t.Errorf("ReconcileProvisioner.reconcileDeployment() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
		targetProvisionerInstance := &appsv1.Deployment{}
		g.Eventually(func() error {
			return c2.Get(context.TODO(), types.NamespacedName{Name: "provisioner", Namespace: constants.InteroperatorNamespace}, targetProvisionerInstance)
		}, timeout).Should(gomega.Succeed())
	}
}

func TestReconcileProvisioner_reconcileClusterRoleBinding(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()

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
	c2, err := client.New(cfg2, client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	// Delete clusterrolebinding in target cluster if present

	targetClusterRoleBinding := &v1.ClusterRoleBinding{}
	err = c2.Get(context.TODO(), types.NamespacedName{Name: "provisioner-clusterrolebinding", Namespace: constants.InteroperatorNamespace}, targetClusterRoleBinding)
	if err == nil {
		c2.Delete(context.TODO(), targetClusterRoleBinding)
	}

	mockClusterRegistry := mock_clusterRegistry.NewMockClusterRegistry(ctrl)

	r := &ReconcileProvisioner{
		Client:          c,
		Log:             ctrlrun.Log.WithName("mcd").WithName("provisioner"),
		scheme:          mgr.GetScheme(),
		clusterRegistry: mockClusterRegistry,
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
				namespace:    constants.InteroperatorNamespace,
				clusterID:    "2",
				targetClient: c2,
			},
			wantErr: false,
		},
		{
			name: "Update if clusterrolebinding already exists",
			args: args{
				namespace:    constants.InteroperatorNamespace,
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
		g.Eventually(func() error {
			return c2.Get(context.TODO(), types.NamespacedName{Name: "provisioner-clusterrolebinding", Namespace: constants.InteroperatorNamespace}, targetClusterRoleBinding)
		}, timeout).Should(gomega.Succeed())
	}
}
