package resources

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis"
	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/properties"
	"github.com/onsi/gomega"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
)

var cfg *rest.Config
var c client.Client

const timeout = time.Second * 5

func TestMain(m *testing.M) {
	t := &envtest.Environment{
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "..", "config", "crds")},
	}
	apis.AddToScheme(scheme.Scheme)
	var err error
	if cfg, err = t.Start(); err != nil {
		log.Fatal(err)
	}

	if c, err = client.New(cfg, client.Options{Scheme: scheme.Scheme}); err != nil {
		log.Fatal(err)
	}

	code := m.Run()
	t.Stop()
	os.Exit(code)
}

func TestNew(t *testing.T) {
	tests := []struct {
		name string
		want ResourceManager
	}{
		{
			name: "Test1",
			want: resourceManager{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := New(); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("New() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_resourceManager_fetchResources(t *testing.T) {
	g := gomega.NewGomegaWithT(t)

	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action:         "provision",
			Type:           "gotemplate",
			ContentEncoded: "cHJvdmlzaW9uY29udGVudA==",
		},
		osbv1alpha1.TemplateSpec{
			Action:         "bind",
			Type:           "gotemplate",
			ContentEncoded: "YmluZGNvbnRlbnQ=",
		},
		osbv1alpha1.TemplateSpec{
			Action:         "properties",
			Type:           "gotemplate",
			ContentEncoded: "cHJvcGVydGllc2NvbnRlbnQ=",
		},
		osbv1alpha1.TemplateSpec{
			Action:         "sources",
			Type:           "gotemplate",
			ContentEncoded: "c291cmNlc2NvbnRlbnQ=",
		},
	}
	plan := &osbv1alpha1.SFPlan{
		TypeMeta: metav1.TypeMeta{
			Kind:       "SFPlan",
			APIVersion: "osb.servicefabrik.io/v1alpha1",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "plan-id",
			Namespace: "default",
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
	service := &osbv1alpha1.SFService{
		TypeMeta: metav1.TypeMeta{
			Kind:       "SFService",
			APIVersion: "osb.servicefabrik.io/v1alpha1",
		},
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
			DashboardClient: osbv1alpha1.DashboardClient{
				ID:          "id",
				Secret:      "secret",
				RedirectURI: "redirecturi",
			},
			PlanUpdatable: true,
			RawContext:    nil,
		},
	}

	spec := osbv1alpha1.SFServiceInstanceSpec{}
	instance := &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "instance-id",
			Namespace: "default",
		},
		Spec: spec,
		Status: osbv1alpha1.SFServiceInstanceStatus{
			DashboardURL: "",
			State:        "",
			Error:        "",
			Description:  "",
			AppliedSpec:  spec,
			CRDs: []osbv1alpha1.Source{
				{
					APIVersion: "v1alpha1",
					Kind:       "Director",
					Name:       "dddd",
					Namespace:  "default",
				},
			},
		},
	}

	binding := &osbv1alpha1.SFServiceBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "binding-id",
			Namespace: "default",
		},
	}

	var serviceKey = types.NamespacedName{Name: "service-id", Namespace: "default"}
	var planKey = types.NamespacedName{Name: "plan-id", Namespace: "default"}
	var instanceKey = types.NamespacedName{Name: "instance-id", Namespace: "default"}
	var bindingKey = types.NamespacedName{Name: "binding-id", Namespace: "default"}

	g.Expect(c.Create(context.TODO(), service)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), plan)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), binding)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), service)
	defer c.Delete(context.TODO(), plan)
	defer c.Delete(context.TODO(), instance)
	defer c.Delete(context.TODO(), binding)

	g.Eventually(func() error { return c.Get(context.TODO(), serviceKey, service) }, timeout).
		Should(gomega.Succeed())
	g.Eventually(func() error { return c.Get(context.TODO(), planKey, plan) }, timeout).
		Should(gomega.Succeed())
	g.Eventually(func() error { return c.Get(context.TODO(), instanceKey, instance) }, timeout).
		Should(gomega.Succeed())
	g.Eventually(func() error { return c.Get(context.TODO(), bindingKey, binding) }, timeout).
		Should(gomega.Succeed())

	type args struct {
		client     kubernetes.Client
		instanceID string
		bindingID  string
		serviceID  string
		planID     string
		namespace  string
	}
	tests := []struct {
		name    string
		r       resourceManager
		args    args
		want    *osbv1alpha1.SFServiceInstance
		want1   *osbv1alpha1.SFServiceBinding
		want2   *osbv1alpha1.SFService
		want3   *osbv1alpha1.SFPlan
		wantErr bool
	}{
		{
			name: "Test1",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id",
				serviceID:  "service-id",
				planID:     "plan-id",
				namespace:  "default",
			},
			want:    instance,
			want1:   binding,
			want2:   service,
			want3:   plan,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			got, got1, got2, got3, err := r.fetchResources(tt.args.client, tt.args.instanceID, tt.args.bindingID, tt.args.serviceID, tt.args.planID, tt.args.namespace)
			if (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.fetchResources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("resourceManager.fetchResources() got = %v, want %v", got, tt.want)
			}
			if !reflect.DeepEqual(got1, tt.want1) {
				t.Errorf("resourceManager.fetchResources() got1 = %v, want %v", got1, tt.want1)
			}
			if !reflect.DeepEqual(got2.Spec, tt.want2.Spec) {
				t.Errorf("resourceManager.fetchResources() got2 = %v, want %v", got2.Spec, tt.want2.Spec)
			}
			if !reflect.DeepEqual(got3.Spec, tt.want3.Spec) {
				t.Errorf("resourceManager.fetchResources() got3 = %v, want %v", got3.Spec, tt.want3.Spec)
			}
		})
	}
}

func Test_resourceManager_ComputeExpectedResources(t *testing.T) {
	g := gomega.NewGomegaWithT(t)

	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action:         "provision",
			Type:           "gotemplate",
			ContentEncoded: "YXBpVmVyc2lvbjoga3ViZWRiLmNvbS92MWFscGhhMQpraW5kOiBQb3N0Z3Jlcw==",
		},
		osbv1alpha1.TemplateSpec{
			Action:         "bind",
			Type:           "gotemplate",
			ContentEncoded: "YmluZGNvbnRlbnQ=",
		},
		osbv1alpha1.TemplateSpec{
			Action:         "properties",
			Type:           "gotemplate",
			ContentEncoded: "cHJvcGVydGllc2NvbnRlbnQ=",
		},
		osbv1alpha1.TemplateSpec{
			Action:         "sources",
			Type:           "gotemplate",
			ContentEncoded: "c291cmNlc2NvbnRlbnQ=",
		},
	}
	plan := &osbv1alpha1.SFPlan{
		TypeMeta: metav1.TypeMeta{
			Kind:       "SFPlan",
			APIVersion: "osb.servicefabrik.io/v1alpha1",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      "plan-id",
			Namespace: "default",
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
	service := &osbv1alpha1.SFService{
		TypeMeta: metav1.TypeMeta{
			Kind:       "SFService",
			APIVersion: "osb.servicefabrik.io/v1alpha1",
		},
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
			DashboardClient: osbv1alpha1.DashboardClient{
				ID:          "id",
				Secret:      "secret",
				RedirectURI: "redirecturi",
			},
			PlanUpdatable: true,
			RawContext:    nil,
		},
	}

	spec := osbv1alpha1.SFServiceInstanceSpec{}
	instance := &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "instance-id",
			Namespace: "default",
		},
		Spec: spec,
		Status: osbv1alpha1.SFServiceInstanceStatus{
			DashboardURL: "",
			State:        "",
			Error:        "",
			Description:  "",
			AppliedSpec:  spec,
			CRDs: []osbv1alpha1.Source{
				{
					APIVersion: "v1alpha1",
					Kind:       "Director",
					Name:       "dddd",
					Namespace:  "default",
				},
			},
		},
	}

	binding := &osbv1alpha1.SFServiceBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "binding-id",
			Namespace: "default",
		},
	}

	var serviceKey = types.NamespacedName{Name: "service-id", Namespace: "default"}
	var planKey = types.NamespacedName{Name: "plan-id", Namespace: "default"}
	var instanceKey = types.NamespacedName{Name: "instance-id", Namespace: "default"}
	var bindingKey = types.NamespacedName{Name: "binding-id", Namespace: "default"}

	g.Expect(c.Create(context.TODO(), service)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), plan)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), instance)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), binding)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), service)
	defer c.Delete(context.TODO(), plan)
	defer c.Delete(context.TODO(), instance)
	defer c.Delete(context.TODO(), binding)

	g.Eventually(func() error { return c.Get(context.TODO(), serviceKey, service) }, timeout).
		Should(gomega.Succeed())
	g.Eventually(func() error { return c.Get(context.TODO(), planKey, plan) }, timeout).
		Should(gomega.Succeed())
	g.Eventually(func() error { return c.Get(context.TODO(), instanceKey, instance) }, timeout).
		Should(gomega.Succeed())
	g.Eventually(func() error { return c.Get(context.TODO(), bindingKey, binding) }, timeout).
		Should(gomega.Succeed())

	output := &unstructured.Unstructured{}
	output.SetAPIVersion("kubedb.com/v1alpha1")
	output.SetKind("Postgres")
	output.SetNamespace("default")

	type args struct {
		client     kubernetes.Client
		instanceID string
		bindingID  string
		serviceID  string
		planID     string
		action     string
		namespace  string
	}
	tests := []struct {
		name    string
		r       resourceManager
		args    args
		want    []*unstructured.Unstructured
		wantErr bool
	}{
		{
			name: "Test1",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id",
				serviceID:  "service-id",
				planID:     "plan-id",
				action:     "provision",
				namespace:  "default",
			},
			want:    []*unstructured.Unstructured{output},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			got, err := r.ComputeExpectedResources(tt.args.client, tt.args.instanceID, tt.args.bindingID, tt.args.serviceID, tt.args.planID, tt.args.action, tt.args.namespace)
			if (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.ComputeExpectedResources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("resourceManager.ComputeExpectedResources() = %s, want %s", got, tt.want)
			}
		})
	}
}

func Test_resourceManager_SetOwnerReference(t *testing.T) {
	type args struct {
		owner     metav1.Object
		resources []*unstructured.Unstructured
		scheme    *runtime.Scheme
	}

	resource := &unstructured.Unstructured{}
	resource.SetAPIVersion("kubedb.com/v1alpha1")
	resource.SetKind("Postgres")
	resource.SetNamespace("default")

	spec := osbv1alpha1.SFServiceInstanceSpec{}
	owner := &osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "instance-id",
			Namespace: "default",
		},
		Spec: spec,
		Status: osbv1alpha1.SFServiceInstanceStatus{
			DashboardURL: "",
			State:        "",
			Error:        "",
			Description:  "",
			AppliedSpec:  spec,
			CRDs: []osbv1alpha1.Source{
				{
					APIVersion: "v1alpha1",
					Kind:       "Director",
					Name:       "dddd",
					Namespace:  "default",
				},
			},
		},
	}

	tests := []struct {
		name    string
		r       resourceManager
		args    args
		wantErr bool
	}{
		{
			name: "Test1",
			r:    resourceManager{},
			args: args{
				owner:     owner,
				resources: []*unstructured.Unstructured{resource},
				scheme:    scheme.Scheme,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			if err := r.SetOwnerReference(tt.args.owner, tt.args.resources, tt.args.scheme); (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.SetOwnerReference() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func Test_resourceManager_ReconcileResources(t *testing.T) {
	type args struct {
		sourceClient      kubernetes.Client
		targetClient      kubernetes.Client
		expectedResources []*unstructured.Unstructured
		lastResources     []osbv1alpha1.Source
	}
	tests := []struct {
		name    string
		r       resourceManager
		args    args
		want    []*unstructured.Unstructured
		wantErr bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			got, err := r.ReconcileResources(tt.args.sourceClient, tt.args.targetClient, tt.args.expectedResources, tt.args.lastResources)
			if (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.ReconcileResources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("resourceManager.ReconcileResources() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_resourceManager_findUnstructuredObject(t *testing.T) {
	type args struct {
		list []*unstructured.Unstructured
		item *unstructured.Unstructured
	}
	tests := []struct {
		name string
		r    resourceManager
		args args
		want bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			if got := r.findUnstructuredObject(tt.args.list, tt.args.item); got != tt.want {
				t.Errorf("resourceManager.findUnstructuredObject() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_resourceManager_ComputeProperties(t *testing.T) {
	type args struct {
		sourceClient kubernetes.Client
		targetClient kubernetes.Client
		instanceID   string
		bindingID    string
		serviceID    string
		planID       string
		action       string
		namespace    string
	}
	tests := []struct {
		name    string
		r       resourceManager
		args    args
		want    *properties.Properties
		wantErr bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			got, err := r.ComputeProperties(tt.args.sourceClient, tt.args.targetClient, tt.args.instanceID, tt.args.bindingID, tt.args.serviceID, tt.args.planID, tt.args.action, tt.args.namespace)
			if (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.ComputeProperties() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("resourceManager.ComputeProperties() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_resourceManager_DeleteSubResources(t *testing.T) {
	type args struct {
		client       kubernetes.Client
		subResources []osbv1alpha1.Source
	}
	tests := []struct {
		name    string
		r       resourceManager
		args    args
		want    []osbv1alpha1.Source
		wantErr bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			got, err := r.DeleteSubResources(tt.args.client, tt.args.subResources)
			if (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.DeleteSubResources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("resourceManager.DeleteSubResources() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_resourceManager_deleteSubResource(t *testing.T) {
	type args struct {
		client   kubernetes.Client
		resource *unstructured.Unstructured
	}
	tests := []struct {
		name    string
		r       resourceManager
		args    args
		wantErr bool
	}{
		// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			if err := r.deleteSubResource(tt.args.client, tt.args.resource); (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.deleteSubResource() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
