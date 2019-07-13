package watches

import (
	"context"
	stdlog "log"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis"
	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
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
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var kubeConfig *rest.Config
var sch *runtime.Scheme
var c client.Client

const timeout = time.Second * 5

func TestMain(m *testing.M) {
	t := &envtest.Environment{
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "config", "crds")},
	}
	apis.AddToScheme(scheme.Scheme)
	var err error
	if kubeConfig, err = t.Start(); err != nil {
		stdlog.Fatal(err)
	}

	if c, err = client.New(kubeConfig, client.Options{Scheme: scheme.Scheme}); err != nil {
		stdlog.Fatal(err)
	}
	sch = scheme.Scheme

	logf.SetLogger(logf.ZapLogger(false))
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
				namespace: "default",
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
				namespace: "default",
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
				namespace: "default",
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
				namespace: "default",
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
				namespace: "default",
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
				namespace: "default",
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
			Namespace: "default",
			Labels:    map[string]string{"serviceId": "service-id"},
		},
		Spec: osbv1alpha1.SFServiceSpec{
			Name:                "service-name",
			ID:                  "service-id",
			Description:         "description",
			Tags:                []string{"foo", "bar"},
			Requires:            []string{"foo", "bar"},
			Bindable:            true,
			InstanceRetrievable: true,
			BindingRetrievable:  true,
			Metadata:            nil,
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
			Namespace:  "default",
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
			Namespace: "default",
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
			Namespace: "default",
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
