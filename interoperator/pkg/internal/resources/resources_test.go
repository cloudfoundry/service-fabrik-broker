package resources

import (
	"context"
	stdlog "log"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/dynamic"

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
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "..", "..", "broker", "config", "crds")},
	}
	apis.AddToScheme(scheme.Scheme)
	var err error
	if cfg, err = t.Start(); err != nil {
		stdlog.Fatal(err)
	}

	if c, err = client.New(cfg, client.Options{Scheme: scheme.Scheme}); err != nil {
		stdlog.Fatal(err)
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
			Action:         "status",
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
			DashboardClient: &osbv1alpha1.DashboardClient{
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
			Resources: []osbv1alpha1.Source{
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
			name: "TestValid",
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
		{
			name: "TestErrorInstanceNotFound",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id2",
				bindingID:  "binding-id",
				serviceID:  "service-id",
				planID:     "plan-id",
				namespace:  "default",
			},
			want:    nil,
			want1:   nil,
			want2:   nil,
			want3:   nil,
			wantErr: true,
		},
		{
			name: "TestErrorBindingNotFound",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id2",
				serviceID:  "service-id",
				planID:     "plan-id",
				namespace:  "default",
			},
			want:    nil,
			want1:   nil,
			want2:   nil,
			want3:   nil,
			wantErr: true,
		},
		{
			name: "TestErrorServiceNotFound",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id",
				serviceID:  "service-id2",
				planID:     "plan-id",
				namespace:  "default",
			},
			want:    nil,
			want1:   nil,
			want2:   nil,
			want3:   nil,
			wantErr: true,
		},
		{
			name: "TestErrorPlanNotFound",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id",
				serviceID:  "service-id",
				planID:     "plan-id2",
				namespace:  "default",
			},
			want:    nil,
			want1:   nil,
			want2:   nil,
			want3:   nil,
			wantErr: true,
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
			if tt.want2 != nil && !reflect.DeepEqual(got2.Spec, tt.want2.Spec) {
				t.Errorf("resourceManager.fetchResources() got2 = %v, want %v", got2.Spec, tt.want2.Spec)
			}
			if tt.want3 != nil && !reflect.DeepEqual(got3.Spec, tt.want3.Spec) {
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
			ContentEncoded: "YXBpVmVyc2lvbjoga3ViZWRiLmNvbS92MWFscGhhMQpraW5kOiBQb3N0Z3Jlcw==",
		},
		osbv1alpha1.TemplateSpec{
			Action:         "status",
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
			DashboardClient: &osbv1alpha1.DashboardClient{
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
			Resources: []osbv1alpha1.Source{
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
			name: "TestValidProvision",
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
		{
			name: "TestValidBind",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id",
				serviceID:  "service-id",
				planID:     "plan-id",
				action:     "bind",
				namespace:  "default",
			},
			want:    []*unstructured.Unstructured{output},
			wantErr: false,
		},
		{
			name: "TestErrorFetchResourceNotFound",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id2",
				bindingID:  "binding-id",
				serviceID:  "service-id",
				planID:     "plan-id",
				action:     "provision",
				namespace:  "default",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "TestInValidTemplate",
			r:    resourceManager{},
			args: args{
				client:     c,
				instanceID: "instance-id",
				bindingID:  "binding-id",
				serviceID:  "service-id",
				planID:     "plan-id",
				action:     "provisionInvalid",
				namespace:  "default",
			},
			want:    nil,
			wantErr: true,
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
				t.Errorf("resourceManager.ComputeExpectedResources() = %v, want %v", got, tt.want)
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
			Resources: []osbv1alpha1.Source{
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

func Test_resourceManager_ReconcileResources_ResourceNotFound(t *testing.T) {
	resource := &unstructured.Unstructured{}
	resource.SetAPIVersion("deployment.servicefabrik.io/v1alpha1")
	resource.SetKind("Director")
	resource.SetNamespace("default")
	resource.SetName("instance-id")
	defer c.Delete(context.TODO(), resource)

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
		{
			name: "Test1",
			r:    resourceManager{},
			args: args{
				sourceClient:      c,
				targetClient:      c,
				expectedResources: []*unstructured.Unstructured{resource},
				lastResources:     nil,
			},
			want:    []*unstructured.Unstructured{resource},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			got, err := r.ReconcileResources(tt.args.sourceClient, tt.args.targetClient, tt.args.expectedResources, tt.args.lastResources)
			if (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.ReconcileResources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got[0].GetAPIVersion(), tt.want[0].GetAPIVersion()) {
				t.Errorf("resourceManager.ReconcileResources() = %v, want %v", got, tt.want)
			}
			if !reflect.DeepEqual(got[0].GetKind(), tt.want[0].GetKind()) {
				t.Errorf("resourceManager.ReconcileResources() = %v, want %v", got, tt.want)
			}
			if !reflect.DeepEqual(got[0].GetName(), tt.want[0].GetName()) {
				t.Errorf("resourceManager.ReconcileResources() = %v, want %v", got, tt.want)
			}
			if !reflect.DeepEqual(got[0].GetNamespace(), tt.want[0].GetNamespace()) {
				t.Errorf("resourceManager.ReconcileResources() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_resourceManager_ReconcileResources_ResourceExists(t *testing.T) {
	g := gomega.NewGomegaWithT(t)
	foundResources, err := dynamic.StringToUnstructured(`apiVersion: deployment.servicefabrik.io/v1alpha1
kind: Director
metadata:
  name: instance-id
  namespace: default
  labels:
    state: in_progress
spec:
  options: old-hello
status:
  state: in_progress`)

	g.Expect(err).NotTo(gomega.HaveOccurred())
	g.Expect(len(foundResources)).To(gomega.Equal(1))

	var foundResourceKey = types.NamespacedName{Name: "instance-id", Namespace: "default"}

	expectedResources, err2 := dynamic.StringToUnstructured(`apiVersion: deployment.servicefabrik.io/v1alpha1
kind: Director
metadata:
  labels:
    state: succeeded
  name: instance-id
  namespace: default
spec:
  options: new-hello
status:
  state: succeeded`)

	g.Expect(err2).NotTo(gomega.HaveOccurred())
	g.Expect(len(foundResources)).To(gomega.Equal(1))

	g.Expect(c.Create(context.TODO(), foundResources[0])).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), foundResources[0])
	g.Eventually(func() error { return c.Get(context.TODO(), foundResourceKey, foundResources[0]) }, timeout).
		Should(gomega.Succeed())

	lastResource1 := osbv1alpha1.Source{}
	lastResource1.APIVersion = "deployment.servicefabrik.io/v1alpha1"
	lastResource1.Kind = "Director"
	lastResource1.Namespace = "default"
	lastResource1.Name = "instance-id"

	lastResource2 := osbv1alpha1.Source{}
	lastResource2.APIVersion = "deployment.servicefabrik.io/v1alpha1"
	lastResource2.Kind = "Docker"
	lastResource2.Namespace = "default"
	lastResource2.Name = "instance-id"

	oldResource := &unstructured.Unstructured{}
	oldResource.SetKind(lastResource2.Kind)
	oldResource.SetAPIVersion(lastResource2.APIVersion)
	oldResource.SetName(lastResource2.Name)
	oldResource.SetNamespace(lastResource2.Namespace)

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
		{
			name: "Test1",
			r:    resourceManager{},
			args: args{
				sourceClient:      c,
				targetClient:      c,
				expectedResources: expectedResources,
				lastResources:     []osbv1alpha1.Source{lastResource1, lastResource2},
			},
			want:    append(foundResources, oldResource),
			wantErr: false,
		},
		{
			name: "Test2",
			r:    resourceManager{},
			args: args{
				sourceClient:      c,
				targetClient:      c,
				expectedResources: expectedResources,
				lastResources:     []osbv1alpha1.Source{lastResource1},
			},
			want:    foundResources,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			got, err := r.ReconcileResources(tt.args.sourceClient, tt.args.targetClient, tt.args.expectedResources, tt.args.lastResources)
			if (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.ReconcileResources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got[0].GetAPIVersion(), tt.want[0].GetAPIVersion()) {
				t.Errorf("resourceManager.ReconcileResources() = %v, want %v", got, tt.want)
			}
			if !reflect.DeepEqual(got[0].GetKind(), tt.want[0].GetKind()) {
				t.Errorf("resourceManager.ReconcileResources() = %v, want %v", got, tt.want)
			}
			if !reflect.DeepEqual(got[0].GetName(), tt.want[0].GetName()) {
				t.Errorf("resourceManager.ReconcileResources() = %v, want %v", got, tt.want)
			}
			if !reflect.DeepEqual(got[0].GetNamespace(), tt.want[0].GetNamespace()) {
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

	resource := &unstructured.Unstructured{}
	resource.SetAPIVersion("osb.servicefabrik.io/v1alpha1")
	resource.SetKind("SFServiceInstance")
	resource.SetNamespace("default")
	resource.SetName("instance-id")

	resource2 := &unstructured.Unstructured{}
	resource2.SetAPIVersion("osb.servicefabrik.io/v1alpha1")
	resource2.SetKind("SFServiceInstance")
	resource2.SetNamespace("default")
	resource2.SetName("instance-id2")

	tests := []struct {
		name string
		r    resourceManager
		args args
		want bool
	}{
		{
			name: "TestFound",
			r:    resourceManager{},
			args: args{
				list: []*unstructured.Unstructured{resource, resource2},
				item: resource,
			},
			want: true,
		},
		{
			name: "TestNotFound",
			r:    resourceManager{},
			args: args{
				list: []*unstructured.Unstructured{resource},
				item: resource2,
			},
			want: false,
		},
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

func Test_resourceManager_ComputeStatus(t *testing.T) {

	g := gomega.NewGomegaWithT(t)

	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action: "bind",
			Type:   "gotemplate",
			Content: `{{ $name := "" }}
{{- with .binding.metadata.name }} {{ $name = . }} {{ end }}
{{- $state := "in_queue" }}
{{- with .binding.metadata.labels.state }} {{ $state = . }} {{ end }}
{{- $serviceId := "" }}
{{- $planId := "" }}
{{- $context := "{}" }}
{{- $params := "{}" }}
{{- $acceptsIncomplete := "true" }}
{{- $appGuid := "" }}
{{- $bindResource := "{}" }}
{{- $id := "" }}
{{- $instanceId := "" }}
{{- with .binding.spec }}
  {{- with .serviceId }}
    {{- $serviceId = . }}
  {{- end }}
  {{- with .planId }}
    {{- $planId = . }}
  {{- end }}
  {{- with .context }}
    {{- $context = (marshalJSON .) }}
  {{- end }}
  {{- with .parameters }}
    {{- $params = (marshalJSON .) }}
  {{- end }}
  {{- with .acceptsIncomplete }}
    {{- $acceptsIncomplete = . }}
  {{- end }}
  {{- with .appGuid }}
    {{- $appGuid = . }}
  {{- end }}
  {{- with .bindResource }}
    {{- $bindResource = (marshalJSON .) }}
  {{- end }}
  {{- with .id }}
    {{- $id = . }}
  {{- end }}
  {{- with .instanceId }}
    {{- $instanceId = . }}
  {{- end }}
{{- end }}


apiVersion: bind.servicefabrik.io/v1alpha1
kind: DirectorBind
metadata:
  labels:
    state: {{ $state }}
    instance_guid: {{ $instanceId }}
  name: {{ $name }}
spec:
  options: {{ (printf "{ \"service_id\": \"%s\", \"plan_id\": \"%s\", \"app_guid\": \"%s\", \"bind_resource\": %s, \"context\": %s, \"binding_id\": \"%s\", \"parameters\": %s, \"accepts_incomplete\": %s }" $serviceId $planId $appGuid $bindResource $context $id $params $acceptsIncomplete) | quote }}
status:
  state: {{ $state }}`,
		},
		osbv1alpha1.TemplateSpec{
			Action: "provision",
			Type:   "gotemplate",
			Content: `{{ $name := "" }}
{{- with .instance.metadata.name }} {{ $name = . }} {{ end }}
{{- $state := "in_queue" }}
{{- with .instance.metadata.labels.state }} {{ $state = . }} {{ end }}
{{- $serviceId := "" }}
{{- $planId := "" }}
{{- $organizationGuid := "" }}
{{- $spaceGuid := "" }}
{{- $context := "{}" }}
{{- $params := "{}" }}
{{- $previousValues := "{}" }}
{{- with .instance.spec }}
  {{- with .serviceId }}
    {{- $serviceId = . }}
  {{- end }}
  {{- with .planId }}
    {{- $planId = . }}
  {{- end }}
  {{- with .organizationGuid }}
    {{- $organizationGuid = . }}
  {{- end }}
  {{- with .spaceGuid }}
    {{- $spaceGuid = . }}
  {{- end }}
  {{- with .context }}
    {{- $context = (marshalJSON .) }}
  {{- end }}
  {{- with .parameters }}
    {{- $params = (marshalJSON .) }}
  {{- end }}
  {{- with .previousValues }}
    {{- $previousValues = (marshalJSON .) }}
  {{- end }}
{{- end }}
{{- $options := (printf "{ \"service_id\": \"%s\", \"plan_id\": \"%s\", \"organization_guid\": \"%s\", \"space_guid\": \"%s\", \"context\": %s, \"parameters\": %s }" $serviceId $planId $organizationGuid $spaceGuid $context $params ) | quote }}
{{- with .instance.spec.previousValues }}
  {{- $options = (printf "{ \"service_id\": \"%s\", \"plan_id\": \"%s\", \"organization_guid\": \"%s\", \"space_guid\": \"%s\", \"context\": %s, \"parameters\": %s, \"previous_values\": %s }" $serviceId $planId $organizationGuid $spaceGuid $context $params $previousValues ) | quote  }}
{{- end }}
apiVersion: deployment.servicefabrik.io/v1alpha1
kind: Director
metadata:
  labels:
    state: {{ $state }}
  name: {{ $name }}
spec:
  options: {{ $options }}
status:
  state: {{ $state }}`,
		},
		osbv1alpha1.TemplateSpec{
			Action: "status",
			Type:   "gotemplate",
			Content: `{{ $name := "" }}
{{- with .director.metadata.name }}
  {{- $name = . }}
{{- end }}
{{- $stateString := "in progress" }}
{{- $response := "" }}
{{- $error := "" }}
{{- with .director.status.lastOperation }}
  {{- $lastOperation := ( unmarshalJSON . ) }}
  {{- $response = $lastOperation.description | quote }}
{{- end }}
{{- with .director.status }}
  {{- if eq .state "succeeded" }}
    {{- $stateString = "succeeded" }}
  {{- else }}
    {{- if eq .state "failed"}}
      {{- $stateString = "failed" }}
      {{- $error =  .error }}
    {{- end }}
  {{- end }}
{{- end }}
{{- if eq $response "" }}
  {{- if eq $stateString "succeeded" }}
    {{- $response = (printf "Service Instance %s creation successful" $name) }}
  {{- else }}
    {{- if eq $stateString "in progress" }}
      {{- $response = (printf "Service Instance %s provision in progress" $name) }}
    {{- else }}
      {{- $response = (printf "Service Instance %s provision failed" $name) }}
    {{- end }}
  {{- end }}
{{- end }}
provision:
  state: {{ $stateString }}
  response: {{ $response }}
{{- if eq $stateString "failed" }}
  error: {{ $error | quote}}
{{- end }}
  dashboardUrl: ""
{{- with .directorbind.status }}
  {{- $response = (b64dec .response | quote) }}
{{- end }}
{{- $stateString = "in_queue" }} 
{{- with .directorbind }}
  {{- with .status }}
    {{- if eq .state "succeeded" }}
      {{- $stateString = "succeeded" }}
    {{- else }}
      {{- if eq .state "failed" }}
        {{- $stateString = "failed" }}
        {{- $error =  .error }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- end }}
bind:
  state: {{ $stateString }}
{{- if eq $stateString "failed" }}
  error: {{ $error | quote }}
{{- end }}
  response: {{ $response }}
{{- with .directorbind.status }}
  {{- $response = (b64dec .response | quote) }}
{{- end }}
{{- $stateString = "delete" }} 
{{- with .directorbind }}
  {{- with .status }}
    {{- if eq .state "succeeded" }}
      {{- $stateString = "succeeded" }}
    {{- else }}
      {{- if eq .state "failed" }}
        {{- $stateString = "failed" }}
        {{- $error =  .error }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- else }}
  {{- $stateString = "succeeded" }}
{{- end }}
unbind:
  state: {{ $stateString }}
{{- if eq $stateString "failed" }}
  error: {{ $error | quote }}
{{- end }}
  response: {{ $response }}
{{- with .director.status.lastOperation }}
  {{- $lastOperation := ( unmarshalJSON . ) }}
  {{- $response = $lastOperation.description | quote }}
{{- end }}
{{- $stateString = "in progress" }} 
{{- with .director }}
  {{- with .status }}
    {{- if eq .state "delete" }}
      {{- $stateString = "in progress" }}
    {{- else }}
      {{- if eq .state "failed" }}
        {{- $stateString = "failed" }}
        {{- $error =  .error }}
      {{- end }}
    {{- end }}
  {{- end }}
{{- else }}
  {{- $stateString = "succeeded" }}
{{- end }}
deprovision:
  state: {{ $stateString }}
{{- if eq $stateString "failed" }}
  error: {{ $error | quote }}
{{- end }}
  response: {{ $response }}`,
		},
		osbv1alpha1.TemplateSpec{
			Action: "sources",
			Type:   "gotemplate",
			Content: `{{- $name := "" }}
{{- $binding := "" }}
{{- with .instance.metadata.name }} {{ $name = . }} {{ end }}
{{- with .binding.metadata.name }} {{ $binding = . }} {{ end }}
{{- $namespace := "default" }}
director:
  apiVersion: "deployment.servicefabrik.io/v1alpha1"
  kind: Director
  name: {{ $name }}
  namespace: {{ $namespace }}
directorbind:
  apiVersion: "bind.servicefabrik.io/v1alpha1"
  kind: DirectorBind
  name: {{ $binding }}
  namespace: {{ $namespace }}`,
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
			DashboardClient: &osbv1alpha1.DashboardClient{
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
			Resources: []osbv1alpha1.Source{
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

	instanceStatus := properties.InstanceStatus{}
	instanceStatus.State = "in progress"
	instanceStatus.Response = "Service Instance  provision in progress"
	instanceStatus.Error = ""
	instanceStatus.DashboardURL = ""

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
		want    *properties.InstanceStatus
		wantErr bool
	}{
		{
			name: "TestInvalidInstanceError",
			r:    resourceManager{},
			args: args{
				sourceClient: c,
				targetClient: c,
				instanceID:   "instance-id2",
				bindingID:    "binding-id",
				serviceID:    "service-id",
				planID:       "plan-id",
				action:       osbv1alpha1.ProvisionAction,
				namespace:    "default",
			},
			want:    nil,
			wantErr: true,
		},
		{
			name: "TestValid",
			r:    resourceManager{},
			args: args{
				sourceClient: c,
				targetClient: c,
				instanceID:   "instance-id",
				bindingID:    "binding-id",
				serviceID:    "service-id",
				planID:       "plan-id",
				action:       osbv1alpha1.ProvisionAction,
				namespace:    "default",
			},
			want:    &instanceStatus,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			got, err := r.ComputeStatus(tt.args.sourceClient, tt.args.targetClient, tt.args.instanceID, tt.args.bindingID, tt.args.serviceID, tt.args.planID, tt.args.action, tt.args.namespace)
			if (err != nil) != tt.wantErr {
				t.Errorf("resourceManager.ComputeStatus() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && !reflect.DeepEqual(got.Provision, *tt.want) {
				t.Errorf("resourceManager.ComputeStatus() = %v, want %v", got.Provision, *tt.want)
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
		setup   func()
		cleanup func()
		want    []osbv1alpha1.Source
		wantErr bool
	}{
		{
			name: "Set state to delete for Director",
			r:    resourceManager{},
			args: args{
				client: c,
				subResources: []osbv1alpha1.Source{
					{
						APIVersion: "deployment.servicefabrik.io/v1alpha1",
						Kind:       "Director",
						Name:       "instance-id",
						Namespace:  "default",
					},
				},
			},
			setup: func() {
				resource := &unstructured.Unstructured{}
				resource.SetKind("Director")
				resource.SetAPIVersion("deployment.servicefabrik.io/v1alpha1")
				resource.SetName("instance-id")
				resource.SetNamespace("default")
				err := c.Create(context.TODO(), resource)
				if err != nil {
					t.Errorf("Failed to create Director %v", err)
				}
			},
			cleanup: func() {
				resource := &unstructured.Unstructured{}
				resource.SetKind("Director")
				resource.SetAPIVersion("deployment.servicefabrik.io/v1alpha1")
				resource.SetName("instance-id")
				resource.SetNamespace("default")

				err := c.Get(context.TODO(), types.NamespacedName{Name: "instance-id", Namespace: "default"}, resource)
				if err != nil {
					t.Errorf("Failed to get Director %v", err)
					return
				}
				content := resource.UnstructuredContent()
				statusInt, ok := content["status"]
				var status map[string]interface{}
				if ok {
					status, ok = statusInt.(map[string]interface{})
					if !ok {
						t.Errorf("status field not map for resource %v", resource)
						return
					}
				} else {
					t.Errorf("Failed to get read status of director %v", err)
					return
				}

				if status["state"] != "delete" {
					t.Errorf("state not set to delete for director. current state %s", status["state"])
					return
				}

				err = c.Delete(context.TODO(), resource)
				if err != nil {
					t.Errorf("Failed to delete Director %v", err)
				}
			},
			want: []osbv1alpha1.Source{
				{
					APIVersion: "deployment.servicefabrik.io/v1alpha1",
					Kind:       "Director",
					Name:       "instance-id",
					Namespace:  "default",
				},
			},
			wantErr: false,
		},
		{
			name: "TestValidCRD",
			r:    resourceManager{},
			args: args{
				client: c,
				subResources: []osbv1alpha1.Source{
					{
						APIVersion: "deployment.servicefabrik.io/v1alpha1",
						Kind:       "Director",
						Name:       "instance-id",
						Namespace:  "default",
					},
				},
			},
			want:    nil,
			wantErr: false,
		},
		{
			name: "TestInvalidCRD",
			r:    resourceManager{},
			args: args{
				client: c,
				subResources: []osbv1alpha1.Source{
					{
						APIVersion: "deployment.servicefabrik.io/v1alpha1",
						Kind:       "Director",
						Name:       "instance-id",
						Namespace:  "default",
					},
					{
						APIVersion: "deployment.servicefabrik.io/v1alpha1",
						Kind:       "Director2",
						Name:       "instance-id",
						Namespace:  "default",
					},
				},
			},
			want: []osbv1alpha1.Source{
				{
					APIVersion: "deployment.servicefabrik.io/v1alpha1",
					Kind:       "Director2",
					Name:       "instance-id",
					Namespace:  "default",
				},
			},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := resourceManager{}
			if tt.setup != nil {
				tt.setup()
			}
			if tt.cleanup != nil {
				defer tt.cleanup()
			}
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
