package factory

import (
	stdlog "log"
	"os"
	"path/filepath"
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/onsi/gomega"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
)

var cfg *rest.Config
var c client.Client

func TestMain(m *testing.M) {
	t := &envtest.Environment{
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "..", "..", "config", "crds")},
	}

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

func TestHelmTemplateRenderer(t *testing.T) {
	g := gomega.NewGomegaWithT(t)

	gopath := os.Getenv("GOPATH")
	if gopath == "" {
		gopath = "/home/travis/gopath"
	}

	templateSpec := []osbv1alpha1.TemplateSpec{
		osbv1alpha1.TemplateSpec{
			Action: "provision",
			Type:   "helm",
			URL:    gopath + "/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/config/samples/templates/helmtemplates/postgresql",
		},
		osbv1alpha1.TemplateSpec{
			Action: "status",
			Type:   "helm",
			URL:    gopath + "/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/config/samples/templates/helmtemplates/postgresqlStatus",
		},
		osbv1alpha1.TemplateSpec{
			Action: "sources",
			Type:   "helm",
			URL:    gopath + "/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/config/samples/templates/helmtemplates/postgresqlStatus",
		},
	}
	plan := osbv1alpha1.SFPlan{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "plan-id",
			Namespace: "default",
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

	service := osbv1alpha1.SFService{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: "default",
		},
	}

	name := types.NamespacedName{
		Name:      "foo",
		Namespace: "default",
	}

	spec := osbv1alpha1.SFServiceInstanceSpec{}
	instance := osbv1alpha1.SFServiceInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
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

	binding := osbv1alpha1.SFServiceBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "foo",
			Namespace: "default",
		},
	}

	template, _ := plan.GetTemplate("provision")
	clientSet, _ := kubernetes.NewForConfig(cfg)
	renderer, _ := GetRenderer(template.Type, clientSet)
	input, _ := GetRendererInput(template, &service, &plan, &instance, &binding, name)
	output, _ := renderer.Render(input)
	files, _ := output.ListFiles()
	content, _ := output.FileContent(files[0])

	g.Expect(len(files)).To(gomega.Equal(1))
	g.Expect(files[0]).To(gomega.Equal("postgres.yaml"))
	g.Expect(content).To(gomega.Equal(
		`apiVersion: kubedb.com/v1alpha1
kind: Postgres
metadata:
  name: kdb-foo-pg
spec:
  version: 10.2-v1
  storageType: Durable
  storage:
    storageClassName: default
    accessModes:
    - ReadWriteOnce
    resources:
      requests:
        storage: 50Mi
  terminationPolicy: WipeOut`))

	clientSet2, _ := kubernetes.NewForConfig(cfg)
	renderer2, _ := GetRenderer(template.Type, clientSet2)
	input2, _ := GetRendererInput(template, &service, &plan, &instance, &binding, name)
	output2, _ := renderer2.Render(input2)
	files2, _ := output2.ListFiles()
	content2, _ := output2.FileContent(files2[0])

	g.Expect(len(files2)).To(gomega.Equal(1))
	g.Expect(files2[0]).To(gomega.Equal("postgres.yaml"))
	g.Expect(content2).To(gomega.Equal(
		`apiVersion: kubedb.com/v1alpha1
kind: Postgres
metadata:
  name: kdb-foo-pg
spec:
  version: 10.2-v1
  storageType: Durable
  storage:
    storageClassName: default
    accessModes:
    - ReadWriteOnce
    resources:
      requests:
        storage: 50Mi
  terminationPolicy: WipeOut`))
}
