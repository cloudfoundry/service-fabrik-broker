package resources

import (
	"testing"

	"github.com/onsi/gomega"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/scheme"
)

func Test_setOwnerReference(t *testing.T) {
	g := gomega.NewGomegaWithT(t)

	type args struct {
		owner  metav1.Object
		object metav1.Object
		scheme *runtime.Scheme
	}
	tests := []struct {
		name    string
		args    args
		setup   func(args)
		verify  func(args)
		wantErr bool
	}{
		{
			name: "fail if owner is nil",
			args: args{
				object: &unstructured.Unstructured{},
				scheme: scheme.Scheme,
			},
			wantErr: true,
		},
		{
			name: "fail if obj is not namespaced",
			args: args{
				owner:  _getDummyInstance(),
				object: _getDummyBinding(),
				scheme: scheme.Scheme,
			},
			setup: func(a args) {
				a.object.SetNamespace("")
			},
			wantErr: true,
		},
		{
			name: "fail if owner and obj namespace is different",
			args: args{
				owner:  _getDummyInstance(),
				object: _getDummyBinding(),
				scheme: scheme.Scheme,
			},
			setup: func(a args) {
				a.object.SetNamespace("default2")
			},
			wantErr: true,
		},
		{
			name: "set owner reference",
			args: args{
				owner:  _getDummyInstance(),
				object: _getDummyBinding(),
				scheme: scheme.Scheme,
			},
			verify: func(a args) {
				ownerReferences := a.object.GetOwnerReferences()
				g.Expect(ownerReferences).To(gomega.HaveLen(1))
			},
			wantErr: false,
		},
		{
			name: "replace existing owner reference",
			args: args{
				owner:  _getDummyInstance(),
				object: _getDummyBinding(),
				scheme: scheme.Scheme,
			},
			setup: func(a args) {
				err := setOwnerReference(a.owner, a.object, a.scheme)
				if err != nil {
					t.Errorf("Failed to set owner reference %v", err)
				}
			},
			verify: func(a args) {
				ownerReferences := a.object.GetOwnerReferences()
				g.Expect(ownerReferences).To(gomega.HaveLen(1))
			},
			wantErr: false,
		},
		{
			name: "add additional owner reference",
			args: args{
				owner:  _getDummyInstance(),
				object: _getDummyBinding(),
				scheme: scheme.Scheme,
			},
			setup: func(a args) {
				err := setOwnerReference(_getDummyPlan(), a.object, a.scheme)
				if err != nil {
					t.Errorf("Failed to set owner reference %v", err)
				}
			},
			verify: func(a args) {
				ownerReferences := a.object.GetOwnerReferences()
				g.Expect(ownerReferences).To(gomega.HaveLen(2))
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		if tt.setup != nil {
			tt.setup(tt.args)
		}
		if tt.verify != nil {
			defer tt.verify(tt.args)
		}
		t.Run(tt.name, func(t *testing.T) {
			if err := setOwnerReference(tt.args.owner, tt.args.object, tt.args.scheme); (err != nil) != tt.wantErr {
				t.Errorf("setOwnerReference() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func Test_referSameObject(t *testing.T) {
	type args struct {
		a metav1.OwnerReference
		b metav1.OwnerReference
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "false if group version of a is invalid",
			args: args{
				a: metav1.OwnerReference{
					APIVersion: "//",
				},
				b: metav1.OwnerReference{},
			},
			want: false,
		},
		{
			name: "false if apiVersion of b is invalid",
			args: args{
				a: metav1.OwnerReference{
					APIVersion: "v1",
				},
				b: metav1.OwnerReference{
					APIVersion: "//",
				},
			},
			want: false,
		},
		{
			name: "true if owner references are same",
			args: args{
				a: metav1.OwnerReference{
					APIVersion: "v1",
					Kind:       "Abc",
					Name:       "foo",
				},
				b: metav1.OwnerReference{
					APIVersion: "v1",
					Kind:       "Abc",
					Name:       "foo",
				},
			},
			want: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := referSameObject(tt.args.a, tt.args.b); got != tt.want {
				t.Errorf("referSameObject() = %v, want %v", got, tt.want)
			}
		})
	}
}
