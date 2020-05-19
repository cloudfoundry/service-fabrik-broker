package utils

import (
	stdlog "log"
	"os"
	"path/filepath"
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/onsi/gomega"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
)

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

	code := m.Run()
	t.Stop()
	os.Exit(code)
}

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

func Test_setInteroperatorNamespaceLabel(t *testing.T) {
	type args struct {
		owner  metav1.Object
		object metav1.Object
	}
	tests := []struct {
		name   string
		args   args
		setup  func(args)
		verify func(args)
	}{
		{
			name: "noop if owner is nil",
			args: args{
				object: &unstructured.Unstructured{},
			},
		},
		{
			name: "noop if object is nil",
			args: args{
				owner: &unstructured.Unstructured{},
			},
		},
		{
			name: "noop if owner does not have labels",
			args: args{
				owner:  &unstructured.Unstructured{},
				object: &unstructured.Unstructured{},
			},
			verify: func(a args) {
				if a.object.GetLabels() != nil {
					t.Errorf("setInteroperatorNamespaceLabel() : labels = %v, want nil", a.object.GetLabels())
				}
			},
		},
		{
			name: "noop if owner does not have required label",
			args: args{
				owner:  &unstructured.Unstructured{},
				object: &unstructured.Unstructured{},
			},
			setup: func(a args) {
				labels := make(map[string]string)
				a.owner.SetLabels(labels)
			},
			verify: func(a args) {
				if a.object.GetLabels() != nil {
					t.Errorf("setInteroperatorNamespaceLabel() : labels = %v, want nil", a.object.GetLabels())
				}
			},
		},
		{
			name: "set object label",
			args: args{
				owner:  &unstructured.Unstructured{},
				object: &unstructured.Unstructured{},
			},
			setup: func(a args) {
				labels := make(map[string]string)
				labels[constants.NamespaceLabelKey] = constants.InteroperatorNamespace
				a.owner.SetLabels(labels)
			},
			verify: func(a args) {
				labels := a.object.GetLabels()
				if labels == nil {
					t.Errorf("setInteroperatorNamespaceLabel() : labels = nil, want %v", a.owner.GetLabels())
				}
				ns, ok := labels[constants.NamespaceLabelKey]
				if !ok {
					t.Errorf("setInteroperatorNamespaceLabel() : label %s = nil, want %s", constants.NamespaceLabelKey, constants.InteroperatorNamespace)
				}
				if ns != constants.InteroperatorNamespace {
					t.Errorf("setInteroperatorNamespaceLabel() : label %s = %s, want %s", constants.NamespaceLabelKey, ns, constants.InteroperatorNamespace)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup(tt.args)
			}
			if tt.verify != nil {
				defer tt.verify(tt.args)
			}
			setInteroperatorNamespaceLabel(tt.args.owner, tt.args.object)
		})
	}
}

func _getDummyInstance() *osbv1alpha1.SFServiceInstance {
	return &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "instance-id",
			Namespace: constants.InteroperatorNamespace,
		},
		Spec: osbv1alpha1.SFServiceInstanceSpec{
			ServiceID: "service-id",
			PlanID:    "plan-id",
		},
		Status: osbv1alpha1.SFServiceInstanceStatus{
			DashboardURL: "",
			State:        "",
			Error:        "",
			Description:  "",
			Resources: []osbv1alpha1.Source{
				{
					APIVersion: "v1alpha1",
					Kind:       "Director",
					Name:       "dddd",
					Namespace:  constants.InteroperatorNamespace,
				},
			},
		},
	}
}

func _getDummyBinding() *osbv1alpha1.SFServiceBinding {
	return &osbv1alpha1.SFServiceBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "binding-id",
			Namespace: constants.InteroperatorNamespace,
		},
	}
}

func _getDummyPlan() *osbv1alpha1.SFPlan {
	templateSpec := []osbv1alpha1.TemplateSpec{
		{
			Action:  "provision",
			Type:    "gotemplate",
			Content: "provisionContent",
		},
		{
			Action:  "bind",
			Type:    "gotemplate",
			Content: "bindContent",
		},
		{
			Action:  "status",
			Type:    "gotemplate",
			Content: "statusContent",
		},
		{
			Action: "sources",
			Type:   "gotemplate",
			Content: `{{- $instanceID := "" }}
{{- $bindingID := "" }}
{{- with .instance.metadata.name }} {{ $instanceID = . }} {{ end }}
{{- with .binding.metadata.name }} {{ $bindingID = . }} {{ end }}
{{- $namespace := "" }}
{{- with .instance.metadata.namespace }} {{ $namespace = . }} {{ end }}
config:
  apiVersion: "v1"
  kind: ConfigMap
  name: {{ $instanceID }}
  namespace: {{ $namespace }}`,
		},
	}
	return &osbv1alpha1.SFPlan{
		TypeMeta: metav1.TypeMeta{
			Kind:       "SFPlan",
			APIVersion: "osb.servicefabrik.io/v1alpha1",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "plan-id",
			Namespace: constants.InteroperatorNamespace,
			Labels:    map[string]string{"serviceId": "service-id", "planId": "plan-id"},
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
		Status: osbv1alpha1.SFPlanStatus{},
	}
}
