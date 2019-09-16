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

func Test_provisioner_FetchStatefulset(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	type fields struct {
		c           client.Client
		statefulSet *appsv1.StatefulSet
		namespace   string
	}
	tests := []struct {
		name    string
		fields  fields
		wantErr bool
		setup   func(*provisioner)
		cleanup func(*provisioner)
	}{
		{
			name: "should fail if statefulset not found",
			fields: fields{
				c:         c,
				namespace: "default",
			},
			wantErr: true,
		},
		{
			name: "should fetch statefulset",
			fields: fields{
				c:         c,
				namespace: "default",
			},
			wantErr: false,
			setup: func(sfs *provisioner) {
				sfset := &appsv1.StatefulSet{
					ObjectMeta: metav1.ObjectMeta{
						Name:      constants.StatefulSetName,
						Namespace: sfs.namespace,
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
				labels := make(map[string]string)
				labels["foo"] = "bar"
				sfset.Spec.Template.SetLabels(labels)
				sfset.Spec.Selector.MatchLabels = labels
				g.Expect(c.Create(context.TODO(), sfset)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(sfs *provisioner) {
				g.Expect(sfs.statefulSet).NotTo(gomega.BeNil())
				g.Expect(c.Delete(context.TODO(), sfs.statefulSet)).NotTo(gomega.HaveOccurred())
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sfs := &provisioner{
				c:           tt.fields.c,
				statefulSet: tt.fields.statefulSet,
				namespace:   tt.fields.namespace,
			}
			if tt.setup != nil {
				tt.setup(sfs)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(sfs)
			}
			if err := sfs.FetchStatefulset(); (err != nil) != tt.wantErr {
				t.Errorf("provisioner.FetchStatefulset() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func Test_provisioner_GetStatefulSet(t *testing.T) {
	type fields struct {
		c           client.Client
		statefulSet *appsv1.StatefulSet
		namespace   string
	}
	tests := []struct {
		name    string
		fields  fields
		want    *appsv1.StatefulSet
		wantErr bool
	}{
		{
			name: "should do nothing if statefulset already fetched",
			fields: fields{
				c:           c,
				namespace:   "default",
				statefulSet: &appsv1.StatefulSet{},
			},
			want:    &appsv1.StatefulSet{},
			wantErr: false,
		},
		{
			name: "should fail if statefulset not found",
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
			sfs := &provisioner{
				c:           tt.fields.c,
				statefulSet: tt.fields.statefulSet,
				namespace:   tt.fields.namespace,
			}
			got, err := sfs.GetStatefulSet()
			if (err != nil) != tt.wantErr {
				t.Errorf("provisioner.GetStatefulSet() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("provisioner.GetStatefulSet() = %v, want %v", got, tt.want)
			}
		})
	}
}
