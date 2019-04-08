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

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/onsi/gomega"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
)

var kubeConfig *rest.Config
var c client.Client

const timeout = time.Second * 5

func TestMain(m *testing.M) {
	t := &envtest.Environment{
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "..", "config", "crds")},
	}
	apis.AddToScheme(scheme.Scheme)
	var err error
	if kubeConfig, err = t.Start(); err != nil {
		stdlog.Fatal(err)
	}

	if c, err = client.New(kubeConfig, client.Options{Scheme: scheme.Scheme}); err != nil {
		stdlog.Fatal(err)
	}

	code := m.Run()
	t.Stop()
	os.Exit(code)
}

func TestNew(t *testing.T) {
	type args struct {
		kubeConfig *rest.Config
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
			name: "create config manager",
			args: args{
				kubeConfig: kubeConfig,
			},
			want:    true,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := New(tt.args.kubeConfig)
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
	cfg, _ := New(kubeConfig)
	data := make(map[string]string)
	data["instanceWorkerCount"] = "2"
	watchList := `
- apiVersion: kubedb.com/v1alpha1
  kind: Postgres
- apiVersion: kubernetes.sapcloud.io/v1alpha1
  kind: Postgresql
- apiVersion: deployment.servicefabrik.io/v1alpha1
  kind: Director`
	data["instanceContollerWatchList"] = watchList
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      constants.ConfigMapName,
			Namespace: constants.DefaultServiceFabrikNamespace,
		},
		Data: data,
	}
	configMapKey := types.NamespacedName{
		Name:      constants.ConfigMapName,
		Namespace: constants.DefaultServiceFabrikNamespace,
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
				data["instanceWorkerCount"] = "invalid"
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
