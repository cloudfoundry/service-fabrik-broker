package watches

import (
	"context"
	stdlog "log"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/onsi/gomega"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
	"sigs.k8s.io/controller-runtime/pkg/event"
	"sigs.k8s.io/controller-runtime/pkg/predicate"
)

var kubeConfig *rest.Config
var sch *runtime.Scheme
var c client.Client

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

func TestInitWatchConfig(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	service := _getDummyService()
	plan := _getDummyPlan()

	type args struct {
		kubeConfig *rest.Config
		scheme     *runtime.Scheme
		mapper     meta.RESTMapper
	}
	tests := []struct {
		name    string
		setup   func()
		args    args
		wantErr bool
		want    bool
		cleanup func()
	}{
		{
			name: "fail on invalid config",
			args: args{
				kubeConfig: nil,
			},
			wantErr: true,
			want:    false,
		},
		{
			name: "fail on invalid scheme",
			args: args{
				kubeConfig: kubeConfig,
			},
			wantErr: true,
			want:    false,
		},
		{
			name: "do nothing watches if no plans",
			args: args{
				kubeConfig: kubeConfig,
				scheme:     sch,
			},
			wantErr: false,
			want:    false,
		},
		{
			name: "update watches if plans are there",
			setup: func() {
				g.Expect(c.Create(context.TODO(), service)).NotTo(gomega.HaveOccurred())
				g.Expect(c.Create(context.TODO(), plan)).NotTo(gomega.HaveOccurred())
			},
			args: args{
				kubeConfig: kubeConfig,
				scheme:     sch,
			},
			wantErr: false,
			want:    true,
		},
		{
			name: "update watches if plans sources are changed",
			setup: func() {
				plan.Spec.Templates[3].Content = `cfg:
  apiVersion: v1
  kind: ConfigMap
  name: name
  namespace: namespace`
				g.Expect(c.Update(context.TODO(), plan)).NotTo(gomega.HaveOccurred())
			},
			args: args{
				kubeConfig: kubeConfig,
				scheme:     sch,
			},
			wantErr: false,
			want:    true,
			cleanup: func() {
				g.Expect(deleteObject(c, plan)).NotTo(gomega.HaveOccurred())
				g.Expect(deleteObject(c, service)).NotTo(gomega.HaveOccurred())
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
			got, err := InitWatchConfig(tt.args.kubeConfig, tt.args.scheme, tt.args.mapper)
			if (err != nil) != tt.wantErr {
				t.Errorf("InitWatchConfig() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("InitWatchConfig() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_computeSources(t *testing.T) {
	service := _getDummyService()
	plan := _getDummyPlan()
	instance := _getDummyInstance()
	binding := _getDummyBinding()
	type args struct {
		c         client.Client
		service   *osbv1alpha1.SFService
		plan      *osbv1alpha1.SFPlan
		instance  *osbv1alpha1.SFServiceInstance
		binding   *osbv1alpha1.SFServiceBinding
		action    string
		namespace string
	}
	tests := []struct {
		name    string
		args    args
		setup   func()
		want    map[string]osbv1alpha1.Source
		wantErr bool
	}{
		{
			name: "fail if sources template not found",
			args: args{
				c:         c,
				service:   service,
				plan:      plan,
				instance:  instance,
				binding:   binding,
				action:    "",
				namespace: constants.InteroperatorNamespace,
			},
			setup: func() {
				plan.Spec.Templates = plan.Spec.Templates[:3]
			},
			wantErr: true,
		},
		{
			name: "fail if sources template is invalid type",
			args: args{
				c:         c,
				service:   service,
				plan:      plan,
				instance:  instance,
				binding:   binding,
				action:    "",
				namespace: constants.InteroperatorNamespace,
			},
			setup: func() {
				plan.Spec.Templates = plan.Spec.Templates[:4]
				plan.Spec.Templates[3].Type = "abc"
			},
			wantErr: true,
		},
		{
			name: "fail if sources template is invalid content",
			args: args{
				c:         c,
				service:   service,
				plan:      plan,
				instance:  instance,
				binding:   binding,
				action:    "",
				namespace: constants.InteroperatorNamespace,
			},
			setup: func() {
				plan.Spec.Templates[3].Type = "gotemplate"
				plan.Spec.Templates[3].Content = ""
				plan.Spec.Templates[3].ContentEncoded = "foo"
			},
			wantErr: true,
		},
		{
			name: "fail if sources template is fail to render content",
			args: args{
				c:         c,
				service:   service,
				plan:      plan,
				instance:  instance,
				binding:   binding,
				action:    "",
				namespace: constants.InteroperatorNamespace,
			},
			setup: func() {
				plan.Spec.Templates[3].ContentEncoded = ""
				plan.Spec.Templates[3].Content = "{{ with .abc }}"
			},
			wantErr: true,
		},
		{
			name: "fail if sources template is not parsable",
			args: args{
				c:         c,
				service:   service,
				plan:      plan,
				instance:  instance,
				binding:   binding,
				action:    "",
				namespace: constants.InteroperatorNamespace,
			},
			setup: func() {
				plan.Spec.Templates[3].Content = "foo"
			},
			wantErr: true,
		},
		{
			name: "return sources array",
			args: args{
				c:         c,
				service:   service,
				plan:      plan,
				instance:  instance,
				binding:   binding,
				action:    osbv1alpha1.BindAction,
				namespace: constants.InteroperatorNamespace,
			},
			setup: func() {
				plan.Spec.Templates[3].Content = `secret:
  apiVersion: v1
  kind: Secret
  name: name
  namespace: namespace`
			},
			wantErr: false,
			want: map[string]osbv1alpha1.Source{
				"secret": osbv1alpha1.Source{
					APIVersion: "v1",
					Kind:       "Secret",
					Name:       "name",
					Namespace:  "namespace",
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup()
			}
			got, err := computeSources(tt.args.c, tt.args.service, tt.args.plan, tt.args.instance, tt.args.binding, tt.args.action, tt.args.namespace)
			if (err != nil) != tt.wantErr {
				t.Errorf("computeSources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("computeSources() = %v, want %v", got, tt.want)
			}
		})
	}
}

func _getDummyService() *osbv1alpha1.SFService {
	return &osbv1alpha1.SFService{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "service-id",
			Namespace: constants.InteroperatorNamespace,
			Labels:    map[string]string{"serviceId": "service-id"},
		},
		Spec: osbv1alpha1.SFServiceSpec{
			Name:                 "service-name",
			ID:                   "service-id",
			Description:          "description",
			Tags:                 []string{"foo", "bar"},
			Requires:             []string{"foo", "bar"},
			Bindable:             true,
			InstancesRetrievable: true,
			BindingsRetrievable:  true,
			Metadata:             nil,
			DashboardClient: &osbv1alpha1.DashboardClient{
				ID:          "id",
				Secret:      "secret",
				RedirectURI: "redirecturi",
			},
			PlanUpdatable: true,
			RawContext:    nil,
		},
	}
}

func _getDummyPlan() *osbv1alpha1.SFPlan {
	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action:  "provision",
			Type:    "gotemplate",
			Content: "provisioncontent",
		},
		osbv1alpha1.TemplateSpec{
			Action:  "bind",
			Type:    "gotemplate",
			Content: "bindcontent",
		},
		osbv1alpha1.TemplateSpec{
			Action:  "status",
			Type:    "gotemplate",
			Content: "statuscontent",
		},
		osbv1alpha1.TemplateSpec{
			Action: "sources",
			Type:   "gotemplate",
			Content: `secret:
  apiVersion: v1
  kind: Secret
  name: name
  namespace: namespace`,
		},
	}
	return &osbv1alpha1.SFPlan{
		ObjectMeta: metav1.ObjectMeta{
			Name:       "plan-id",
			Namespace:  constants.InteroperatorNamespace,
			Labels:     map[string]string{"serviceId": "service-id", "planId": "plan-id"},
			Finalizers: []string{"abc"},
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
	}
}

func _getDummyBinding() *osbv1alpha1.SFServiceBinding {
	return &osbv1alpha1.SFServiceBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "binding-id",
			Namespace: constants.InteroperatorNamespace,
		},
		Spec: osbv1alpha1.SFServiceBindingSpec{
			ServiceID:  "service-id",
			PlanID:     "plan-id",
			InstanceID: "instance-id",
			ID:         "binding-id",
		},
	}
}

func deleteObject(c client.Client, object k8sObject) error {
	var err error
	for retry := 0; retry < constants.ErrorThreshold; retry++ {
		err = _deleteObject(c, object)
		if err == nil {
			return nil
		}
	}
	return err
}

func _deleteObject(c client.Client, object k8sObject) error {
	var key = types.NamespacedName{
		Name:      object.GetName(),
		Namespace: object.GetNamespace(),
	}
	err := c.Delete(context.TODO(), object)
	if apiErrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}

	err = c.Get(context.TODO(), key, object)
	if apiErrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}

	object.SetFinalizers([]string{})
	err = c.Update(context.TODO(), object)
	if apiErrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return err
	}

	log.Info("Deleted", "object", object.GetObjectKind().GroupVersionKind(), "name", object.GetName())
	return nil
}

func TestNamespaceLabelFilter(t *testing.T) {
	obj1 := &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{},
	}
	obj2 := &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{}},
	}
	obj3 := &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{
			constants.NamespaceLabelKey: "biz",
		}},
	}
	obj4 := &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{
			constants.NamespaceLabelKey: constants.InteroperatorNamespace,
		}},
	}
	tests := []struct {
		name   string
		verify func(predicate.Predicate)
	}{
		{
			name: "create a filter which filters based on namespace",
			verify: func(p predicate.Predicate) {
				evt := event.CreateEvent{
					Object: obj1,
					Meta:   obj1.GetObjectMeta(),
				}
				if got := p.Create(evt); !got {
					t.Errorf("NamespaceLabelFilter() on create = %v, want %v", got, true)
				}

				evt = event.CreateEvent{
					Object: obj2,
					Meta:   obj2.GetObjectMeta(),
				}
				if got := p.Create(evt); !got {
					t.Errorf("NamespaceLabelFilter() on create = %v, want %v", got, true)
				}

				evt = event.CreateEvent{
					Object: obj3,
					Meta:   obj3.GetObjectMeta(),
				}
				if got := p.Create(evt); got {
					t.Errorf("NamespaceLabelFilter() on create = %v, want %v", got, false)
				}

				evt = event.CreateEvent{
					Object: obj4,
					Meta:   obj4.GetObjectMeta(),
				}
				if got := p.Create(evt); !got {
					t.Errorf("NamespaceLabelFilter() on create = %v, want %v", got, true)
				}

				evt2 := event.DeleteEvent{
					Object: obj3,
					Meta:   obj3.GetObjectMeta(),
				}
				if got := p.Delete(evt2); got {
					t.Errorf("NamespaceLabelFilter() on delete = %v, want %v", got, false)
				}

				evt2 = event.DeleteEvent{
					Object: obj4,
					Meta:   obj4.GetObjectMeta(),
				}
				if got := p.Delete(evt2); !got {
					t.Errorf("NamespaceLabelFilter() on delete = %v, want %v", got, true)
				}

				evt3 := event.UpdateEvent{
					ObjectNew: obj3,
					MetaNew:   obj3.GetObjectMeta(),
				}
				if got := p.Update(evt3); got {
					t.Errorf("NamespaceLabelFilter() on update = %v, want %v", got, false)
				}

				evt3 = event.UpdateEvent{
					ObjectNew: obj4,
					MetaNew:   obj4.GetObjectMeta(),
				}
				if got := p.Update(evt3); !got {
					t.Errorf("NamespaceLabelFilter() on update = %v, want %v", got, true)
				}

				evt4 := event.GenericEvent{
					Object: obj3,
					Meta:   obj3.GetObjectMeta(),
				}
				if got := p.Generic(evt4); got {
					t.Errorf("NamespaceLabelFilter() on generic = %v, want %v", got, false)
				}

				evt4 = event.GenericEvent{
					Object: obj4,
					Meta:   obj4.GetObjectMeta(),
				}
				if got := p.Generic(evt4); !got {
					t.Errorf("NamespaceLabelFilter() on generic = %v, want %v", got, true)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NamespaceLabelFilter()
			if tt.verify != nil {
				tt.verify(got)
			}
		})
	}
}

func TestNamespaceFilter(t *testing.T) {
	obj1 := &osbv1alpha1.SFPlan{
		ObjectMeta: metav1.ObjectMeta{Namespace: "biz", Name: "baz"},
	}
	obj2 := &osbv1alpha1.SFPlan{
		ObjectMeta: metav1.ObjectMeta{Namespace: constants.InteroperatorNamespace, Name: "baz"},
	}

	tests := []struct {
		name   string
		verify func(predicate.Predicate)
	}{
		{
			name: "create a filter which filters based on namespace",
			verify: func(p predicate.Predicate) {
				evt := event.CreateEvent{
					Object: obj1,
					Meta:   obj1.GetObjectMeta(),
				}
				if got := p.Create(evt); got {
					t.Errorf("NamespaceFilter() on create = %v, want %v", got, false)
				}

				evt = event.CreateEvent{
					Object: obj2,
					Meta:   obj2.GetObjectMeta(),
				}
				if got := p.Create(evt); !got {
					t.Errorf("NamespaceFilter() on create = %v, want %v", got, true)
				}

				evt2 := event.DeleteEvent{
					Object: obj1,
					Meta:   obj1.GetObjectMeta(),
				}
				if got := p.Delete(evt2); got {
					t.Errorf("NamespaceFilter() on delete = %v, want %v", got, false)
				}

				evt2 = event.DeleteEvent{
					Object: obj2,
					Meta:   obj2.GetObjectMeta(),
				}
				if got := p.Delete(evt2); !got {
					t.Errorf("NamespaceFilter() on delete = %v, want %v", got, true)
				}

				evt3 := event.UpdateEvent{
					ObjectNew: obj1,
					MetaNew:   obj1.GetObjectMeta(),
				}
				if got := p.Update(evt3); got {
					t.Errorf("NamespaceFilter() on update = %v, want %v", got, false)
				}

				evt3 = event.UpdateEvent{
					ObjectNew: obj2,
					MetaNew:   obj2.GetObjectMeta(),
				}
				if got := p.Update(evt3); !got {
					t.Errorf("NamespaceFilter() on update = %v, want %v", got, true)
				}

				evt4 := event.GenericEvent{
					Object: obj1,
					Meta:   obj1.GetObjectMeta(),
				}
				if got := p.Generic(evt4); got {
					t.Errorf("NamespaceFilter() on generic = %v, want %v", got, false)
				}

				evt4 = event.GenericEvent{
					Object: obj2,
					Meta:   obj2.GetObjectMeta(),
				}
				if got := p.Generic(evt4); !got {
					t.Errorf("NamespaceFilter() on generic = %v, want %v", got, true)
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NamespaceFilter()
			if tt.verify != nil {
				tt.verify(got)
			}
		})
	}
}
