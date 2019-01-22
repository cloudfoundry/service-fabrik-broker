package services

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
	"github.com/onsi/gomega"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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

func TestFindServiceInfo(t *testing.T) {
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
			ContentEncoded: "c3RhdHVzY29udGVudA==",
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

	var serviceKey = types.NamespacedName{Name: "service-id", Namespace: "default"}
	var planKey = types.NamespacedName{Name: "plan-id", Namespace: "default"}

	g.Expect(c.Create(context.TODO(), service)).NotTo(gomega.HaveOccurred())
	g.Expect(c.Create(context.TODO(), plan)).NotTo(gomega.HaveOccurred())
	defer c.Delete(context.TODO(), service)
	defer c.Delete(context.TODO(), plan)

	g.Eventually(func() error { return c.Get(context.TODO(), serviceKey, service) }, timeout).
		Should(gomega.Succeed())
	g.Eventually(func() error { return c.Get(context.TODO(), planKey, plan) }, timeout).
		Should(gomega.Succeed())

	type args struct {
		client    kubernetes.Client
		serviceID string
		planID    string
		namespace string
	}

	tests := []struct {
		name    string
		args    args
		want    *osbv1alpha1.SFService
		want1   *osbv1alpha1.SFPlan
		wantErr bool
	}{
		{
			name: "Test1",
			args: args{
				client:    c,
				serviceID: service.ObjectMeta.Name,
				planID:    plan.ObjectMeta.Name,
				namespace: "default",
			},
			want:    service,
			want1:   plan,
			wantErr: false,
		},
		{
			name: "Test2",
			args: args{
				client:    c,
				serviceID: "non-existent-service",
				planID:    plan.ObjectMeta.Name,
				namespace: "default",
			},
			want:    nil,
			want1:   nil,
			wantErr: true,
		},
		{
			name: "Test3",
			args: args{
				client:    c,
				serviceID: service.ObjectMeta.Name,
				planID:    "non-existent-plan",
				namespace: "default",
			},
			want:    nil,
			want1:   nil,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, got1, err := FindServiceInfo(tt.args.client, tt.args.serviceID, tt.args.planID, tt.args.namespace)
			if (err != nil) != tt.wantErr {
				t.Errorf("FindServiceInfo() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.want != nil && !reflect.DeepEqual(got.Spec, tt.want.Spec) {
				t.Errorf("FindServiceInfo() got = %v, want %v", got, tt.want)
			}
			if tt.want1 != nil && !reflect.DeepEqual(got1.Spec, tt.want1.Spec) {
				t.Errorf("FindServiceInfo() got1 = %v, want %v", got1, tt.want1)
			}
		})
	}
}
