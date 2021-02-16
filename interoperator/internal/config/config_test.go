package config

import (
	"context"
	"fmt"
	stdlog "log"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
)

var kubeConfig *rest.Config
var sch *runtime.Scheme
var c client.Client

const timeout = time.Second * 5

func TestMain(m *testing.M) {
	t := &envtest.Environment{
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "config", "crd", "bases")},
	}

	var err error

	err = osbv1alpha1.AddToScheme(scheme.Scheme)
	if err != nil {
		stdlog.Fatal(err)
	}

	err = resourcev1alpha1.AddToScheme(scheme.Scheme)
	if err != nil {
		stdlog.Fatal(err)
	}

	if kubeConfig, err = t.Start(); err != nil {
		stdlog.Fatal(err)
	}

	if c, err = client.New(kubeConfig, client.Options{Scheme: scheme.Scheme}); err != nil {
		stdlog.Fatal(err)
	}
	sch = scheme.Scheme

	code := m.Run()
	t.Stop()
	os.Exit(code)
}

func TestNew(t *testing.T) {
	type args struct {
		kubeConfig *rest.Config
		scheme     *runtime.Scheme
		mapper     meta.RESTMapper
	}
	tests := []struct {
		name    string
		args    args
		want    bool
		wantErr bool
	}{
		{
			name: "fail on invalid config",
			args: args{
				kubeConfig: nil,
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "fail on invalid scheme",
			args: args{
				kubeConfig: kubeConfig,
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "create config manager",
			args: args{
				kubeConfig: kubeConfig,
				scheme:     sch,
			},
			want:    true,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := New(tt.args.kubeConfig, tt.args.scheme, tt.args.mapper)
			if (err != nil) != tt.wantErr {
				t.Errorf("New() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if (got != nil) != tt.want {
				t.Errorf("New() Config = %v, want %v", got, tt.want)
				return
			}
		})
	}
}

func Test_config_GetConfig(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	cfg, _ := New(kubeConfig, sch, nil)
	data := make(map[string]string)
	config := `
instanceWorkerCount: 2
instanceContollerWatchList:
- apiVersion: kubedb.com/v1alpha1
  kind: Postgres
- apiVersion: kubernetes.sapcloud.io/v1alpha1
  kind: Postgresql
- apiVersion: deployment.servicefabrik.io/v1alpha1
  kind: Director`
	data[constants.ConfigMapKey] = config
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      constants.ConfigMapName,
			Namespace: constants.InteroperatorNamespace,
		},
		Data: data,
	}
	configMapKey := types.NamespacedName{
		Name:      constants.ConfigMapName,
		Namespace: constants.InteroperatorNamespace,
	}
	interoperatorConfig := &InteroperatorConfig{
		BindingWorkerCount:     constants.DefaultBindingWorkerCount,
		InstanceWorkerCount:    constants.DefaultInstanceWorkerCount,
		SchedulerWorkerCount:   constants.DefaultSchedulerWorkerCount,
		ProvisionerWorkerCount: constants.DefaultProvisionerWorkerCount,
		PrimaryClusterID:       "1",
		InstanceContollerWatchList: []osbv1alpha1.APIVersionKind{
			osbv1alpha1.APIVersionKind{
				APIVersion: "kubedb.com/v1alpha1",
				Kind:       "Postgres",
			},
			osbv1alpha1.APIVersionKind{
				APIVersion: "kubernetes.sapcloud.io/v1alpha1",
				Kind:       "Postgresql",
			},
			osbv1alpha1.APIVersionKind{
				APIVersion: "deployment.servicefabrik.io/v1alpha1",
				Kind:       "Director",
			},
		},
	}
	tests := []struct {
		name  string
		setup func()
		cfg   Config
		want  *InteroperatorConfig
	}{
		{
			name: "fetch the configmap return updated config",
			cfg:  cfg,
			setup: func() {
				g.Expect(c.Create(context.TODO(), configMap)).NotTo(gomega.HaveOccurred())
				cm := &corev1.ConfigMap{}
				g.Eventually(func() error {
					err := c.Get(context.TODO(), configMapKey, cm)
					return err
				}, timeout).Should(gomega.Succeed())
				interoperatorConfig.InstanceWorkerCount = 2
			},
			want: interoperatorConfig,
		},
		{
			name: "return default values if configmap has incorrect value",
			cfg:  cfg,
			setup: func() {
				config := `
instanceWorkerCount: invalid
instanceContollerWatchList:
- apiVersion: kubedb.com/v1alpha1
  kind: Postgres
- apiVersion: kubernetes.sapcloud.io/v1alpha1
  kind: Postgresql
- apiVersion: deployment.servicefabrik.io/v1alpha1
  kind: Director`
				data[constants.ConfigMapKey] = config
				g.Expect(c.Update(context.TODO(), configMap)).NotTo(gomega.HaveOccurred())
				interoperatorConfig.InstanceWorkerCount = constants.DefaultInstanceWorkerCount
			},
			want: interoperatorConfig,
		},
		{
			name: "return default values if configmap not found",
			cfg:  cfg,
			setup: func() {
				g.Expect(c.Delete(context.TODO(), configMap)).NotTo(gomega.HaveOccurred())
				g.Eventually(func() error {
					err := c.Get(context.TODO(), configMapKey, configMap)
					if err != nil {
						if apierrors.IsNotFound(err) {
							return nil
						}
						return err
					}
					return fmt.Errorf("not deleted")
				}, timeout).Should(gomega.Succeed())
				interoperatorConfig.InstanceWorkerCount = constants.DefaultInstanceWorkerCount
				interoperatorConfig.InstanceContollerWatchList = nil
			},
			want: interoperatorConfig,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.setup()
			if got := tt.cfg.GetConfig(); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("config.GetConfig() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_config_UpdateConfig(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	cfg, _ := New(kubeConfig, sch, nil)
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      constants.ConfigMapName,
			Namespace: constants.InteroperatorNamespace,
		},
	}
	interoperatorConfig := &InteroperatorConfig{
		BindingWorkerCount:  constants.DefaultBindingWorkerCount,
		InstanceWorkerCount: constants.DefaultInstanceWorkerCount,
		InstanceContollerWatchList: []osbv1alpha1.APIVersionKind{
			osbv1alpha1.APIVersionKind{
				APIVersion: "kubedb.com/v1alpha1",
				Kind:       "Postgres",
			},
			osbv1alpha1.APIVersionKind{
				APIVersion: "kubernetes.sapcloud.io/v1alpha1",
				Kind:       "Postgresql",
			},
			osbv1alpha1.APIVersionKind{
				APIVersion: "deployment.servicefabrik.io/v1alpha1",
				Kind:       "Director",
			},
		},
	}
	type args struct {
		interoperatorConfig *InteroperatorConfig
	}
	tests := []struct {
		name    string
		setup   func()
		cfg     Config
		args    args
		wantErr bool
	}{
		{
			name: "fail on no input",
			cfg:  cfg,
			setup: func() {
			},
			args:    args{},
			wantErr: true,
		},
		{
			name: "create the configmap if not exist",
			cfg:  cfg,
			setup: func() {
			},
			args: args{
				interoperatorConfig: interoperatorConfig,
			},
			wantErr: false,
		},
		{
			name: "update the configmap with new values",
			cfg:  cfg,
			setup: func() {
				interoperatorConfig.BindingContollerWatchList = interoperatorConfig.InstanceContollerWatchList
			},
			args: args{
				interoperatorConfig: interoperatorConfig,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.cfg.UpdateConfig(tt.args.interoperatorConfig); (err != nil) != tt.wantErr {
				t.Errorf("config.UpdateConfig() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
	g.Expect(c.Delete(context.TODO(), configMap)).NotTo(gomega.HaveOccurred())
}
