package registry

import (
	"bytes"
	"context"
	"reflect"
	"testing"
	"text/template"

	resourceV1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"

	"github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
)

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
			name:    "fail if kubeConfig is not passed",
			args:    args{},
			want:    false,
			wantErr: true,
		},
		{
			name: "fail if scheme is not passed",
			args: args{
				kubeConfig: kubeConfig,
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "return ClusterRegistry",
			args: args{
				kubeConfig: kubeConfig,
				scheme:     sch,
				mapper:     mapper,
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
			if _, ok := got.(ClusterRegistry); ok != tt.want {
				t.Errorf("New() = %v, want ClusterRegistry", got)
			}
		})
	}
}

func Test_clusterRegistry_GetClient(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	cluster := _getDummyCluster()
	secret := _getDummySecret()
	cluster.Spec.SecretRef = secret.GetName()
	r, err := New(kubeConfig, sch, mapper)
	if err != nil {
		t.Errorf("Failed to create ClusterRegistry %v", err)
		return
	}
	type args struct {
		clusterID string
	}
	tests := []struct {
		name    string
		setup   func()
		args    args
		want    bool
		wantErr bool
		cleanup func()
	}{
		{
			name: "fail if cluster is not found",
			args: args{
				clusterID: "cluster-id",
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "fail if cluster secret is not found",
			args: args{
				clusterID: "cluster-id",
			},
			setup: func() {
				g.Expect(c.Create(context.TODO(), cluster)).NotTo(gomega.HaveOccurred())
			},
			want:    false,
			wantErr: true,
			cleanup: func() {
				g.Expect(c.Delete(context.TODO(), cluster)).NotTo(gomega.HaveOccurred())
				cluster.SetResourceVersion("")
			},
		},
		{
			name: "return cluster client if found",
			args: args{
				clusterID: "cluster-id",
			},
			setup: func() {
				g.Expect(c.Create(context.TODO(), cluster)).NotTo(gomega.HaveOccurred())
				g.Expect(c.Create(context.TODO(), secret)).NotTo(gomega.HaveOccurred())
			},
			want:    true,
			wantErr: false,
			cleanup: func() {
				g.Expect(c.Delete(context.TODO(), cluster)).NotTo(gomega.HaveOccurred())
				cluster.SetResourceVersion("")
				g.Expect(c.Delete(context.TODO(), secret)).NotTo(gomega.HaveOccurred())
				secret.SetResourceVersion("")
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			if tt.cleanup != nil {
				defer tt.cleanup()
			}
			got, err := r.GetClient(tt.args.clusterID)
			if (err != nil) != tt.wantErr {
				t.Errorf("clusterRegistry.GetClient() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if (got != nil) != tt.want {
				t.Errorf("clusterRegistry.GetClient() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_clusterRegistry_GetCluster(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	cluster := _getDummyCluster()
	r, err := New(kubeConfig, sch, mapper)
	if err != nil {
		t.Errorf("Failed to create ClusterRegistry %v", err)
		return
	}
	type args struct {
		clusterID string
	}
	tests := []struct {
		name    string
		setup   func()
		args    args
		want    resourceV1alpha1.SFClusterInterface
		wantErr bool
		cleanup func()
	}{
		{
			name: "fail if cluster is not found",
			args: args{
				clusterID: "cluster-id",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "return cluster if found",
			args: args{
				clusterID: "cluster-id",
			},
			setup: func() {
				g.Expect(c.Create(context.TODO(), cluster)).NotTo(gomega.HaveOccurred())
			},
			want:    cluster,
			wantErr: false,
			cleanup: func() {
				g.Expect(c.Delete(context.TODO(), cluster)).NotTo(gomega.HaveOccurred())
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			if tt.cleanup != nil {
				defer tt.cleanup()
			}
			got, err := r.GetCluster(tt.args.clusterID)
			if (err != nil) != tt.wantErr {
				t.Errorf("clusterRegistry.GetCluster() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("clusterRegistry.GetCluster() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_clusterRegistry_ListClusters(t *testing.T) {
	r, err := New(kubeConfig, sch, mapper)
	if err != nil {
		t.Errorf("Failed to create ClusterRegistry %v", err)
		return
	}
	type args struct {
		options *kubernetes.ListOptions
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		{
			name:    "return list of clusters",
			args:    args{},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := r.ListClusters(tt.args.options)
			if (err != nil) != tt.wantErr {
				t.Errorf("clusterRegistry.ListClusters() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
		})
	}
}

func _getDummyCluster() *resourceV1alpha1.SFCluster {
	return &resourceV1alpha1.SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cluster-id",
			Namespace: "default",
		},
		Spec: resourceV1alpha1.SFClusterSpec{},
	}
}
func _getDummySecret() *corev1.Secret {
	data := make(map[string][]byte)
	data["kubeconfig"] = _getDummyKubeConfig(kubeConfig.Host)
	return &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cluster-id",
			Namespace: "default",
		},
		Data: data,
	}
}

func _getDummyKubeConfig(host string) []byte {
	kubeConfigTemplate := `apiVersion: v1
kind: Config
preferences: {}
clusters:
- cluster:
    server: {{ .host }}
  name: test
users:
- name: 
contexts:
- context:
    cluster: test
    user:
  name: test
current-context: test`
	engine, err := template.New("kubeConfig").Parse(kubeConfigTemplate)
	if err != nil {
		return nil
	}
	values := make(map[string]interface{})
	values["host"] = host

	buf := new(bytes.Buffer)
	err = engine.Execute(buf, values)
	if err != nil {
		return nil
	}
	return buf.Bytes()
}
