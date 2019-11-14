package provisioner

import (
	"context"
	"reflect"
	"testing"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/onsi/gomega"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
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
			name: "return provisioner",
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
			if _, ok := got.(Provisioner); ok != tt.want {
				t.Errorf("New() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_provisioner_Fetch(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	type fields struct {
		c          client.Client
		deployment *appsv1.Deployment
		namespace  string
	}
	tests := []struct {
		name    string
		fields  fields
		wantErr bool
		setup   func(*provisioner)
		cleanup func(*provisioner)
	}{
		{
			name: "should fail if deployment not found",
			fields: fields{
				c:         c,
				namespace: "default",
			},
			wantErr: true,
		},
		{
			name: "should fetch deployment",
			fields: fields{
				c:         c,
				namespace: "default",
			},
			wantErr: false,
			setup: func(p *provisioner) {
				deployment := &appsv1.Deployment{
					ObjectMeta: metav1.ObjectMeta{
						Name:      constants.ProvisionerName,
						Namespace: p.namespace,
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
							},
						},
					},
				}
				labels := make(map[string]string)
				labels["foo"] = "bar"
				deployment.Spec.Template.SetLabels(labels)
				deployment.Spec.Selector.MatchLabels = labels
				g.Expect(c.Create(context.TODO(), deployment)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(p *provisioner) {
				g.Expect(p.deployment).NotTo(gomega.BeNil())
				g.Expect(c.Delete(context.TODO(), p.deployment)).NotTo(gomega.HaveOccurred())
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &provisioner{
				c:          tt.fields.c,
				deployment: tt.fields.deployment,
				namespace:  tt.fields.namespace,
			}
			if tt.setup != nil {
				tt.setup(p)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(p)
			}
			if err := p.Fetch(); (err != nil) != tt.wantErr {
				t.Errorf("provisioner.Fetch() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func Test_provisioner_Get(t *testing.T) {
	type fields struct {
		c          client.Client
		deployment *appsv1.Deployment
		namespace  string
	}
	tests := []struct {
		name    string
		fields  fields
		want    *appsv1.Deployment
		wantErr bool
	}{
		{
			name: "should do nothing if deployment already fetched",
			fields: fields{
				c:          c,
				namespace:  "default",
				deployment: &appsv1.Deployment{},
			},
			want:    &appsv1.Deployment{},
			wantErr: false,
		},
		{
			name: "should fail if deployment not found",
			fields: fields{
				c:         c,
				namespace: "default",
			},
			want:    nil,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := &provisioner{
				c:          tt.fields.c,
				deployment: tt.fields.deployment,
				namespace:  tt.fields.namespace,
			}
			got, err := p.Get()
			if (err != nil) != tt.wantErr {
				t.Errorf("provisioner.Get() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("provisioner.Get() = %v, want %v", got, tt.want)
			}
		})
	}
}
