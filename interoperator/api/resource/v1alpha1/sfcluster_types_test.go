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

package v1alpha1

import (
	"context"
	"reflect"
	"testing"

	"github.com/onsi/gomega"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
)

func TestStorageSFCluster(t *testing.T) {
	key := types.NamespacedName{
		Name:      "foo",
		Namespace: "default",
	}
	created := &SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: "default",
		}}
	g := gomega.NewGomegaWithT(t)

	// Test Create
	fetched := &SFCluster{}
	g.Expect(c.Create(context.TODO(), created)).NotTo(gomega.HaveOccurred())

	g.Expect(c.Get(context.TODO(), key, fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(fetched).To(gomega.Equal(created))

	// Test Updating the Labels
	updated := fetched.DeepCopy()
	updated.Labels = map[string]string{"hello": "world"}
	g.Expect(c.Update(context.TODO(), updated)).NotTo(gomega.HaveOccurred())

	g.Expect(c.Get(context.TODO(), key, fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(fetched).To(gomega.Equal(updated))

	// Test Delete
	g.Expect(c.Delete(context.TODO(), fetched)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Get(context.TODO(), key, fetched)).To(gomega.HaveOccurred())
}

func TestSFCluster_GetKubeConfig(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	secret := &corev1.Secret{}

	type args struct {
		c kubernetes.Client
	}
	tests := []struct {
		name    string
		args    args
		want    *rest.Config
		wantErr bool
		setup   func(*SFCluster)
		cleanup func(*SFCluster)
	}{
		{
			name: "should fail if secret is not found",
			args: args{
				c: c,
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "should fail if secret does not have kubeconfig field",
			args: args{
				c: c,
			},
			want:    nil,
			wantErr: true,
			setup: func(cluster *SFCluster) {
				secret.SetResourceVersion("")
				secret.SetName(cluster.Spec.SecretRef)
				secret.SetNamespace(cluster.GetNamespace())
				g.Expect(c.Create(context.TODO(), secret)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(cluster *SFCluster) {
				g.Expect(c.Delete(context.TODO(), secret)).NotTo(gomega.HaveOccurred())
			},
		},
		{
			name: "should fail if kubeconfig is not valid",
			args: args{
				c: c,
			},
			want:    nil,
			wantErr: true,
			setup: func(cluster *SFCluster) {
				data := make(map[string][]byte)
				data["kubeconfig"] = []byte("foo")
				secret.SetResourceVersion("")
				secret.SetName(cluster.Spec.SecretRef)
				secret.SetNamespace(cluster.GetNamespace())
				secret.Data = data
				g.Expect(c.Create(context.TODO(), secret)).NotTo(gomega.HaveOccurred())
			},
			cleanup: func(cluster *SFCluster) {
				g.Expect(c.Delete(context.TODO(), secret)).NotTo(gomega.HaveOccurred())
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cluster := _getDummyCluster()
			if tt.setup != nil {
				tt.setup(cluster)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(cluster)
			}
			got, err := cluster.GetKubeConfig(tt.args.c)
			if (err != nil) != tt.wantErr {
				t.Errorf("SFCluster.GetKubeConfig() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("SFCluster.GetKubeConfig() = %v, want %v", got, tt.want)
			}
		})
	}
}

func _getDummyCluster() *SFCluster {
	return &SFCluster{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "cluster-id",
			Namespace: "default",
		},
		Spec: SFClusterSpec{
			SecretRef: "cluster-id-secret",
		},
	}
}
