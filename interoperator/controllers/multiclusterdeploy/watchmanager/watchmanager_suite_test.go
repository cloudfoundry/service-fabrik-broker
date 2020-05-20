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

package watchmanager

import (
	stdlog "log"
	"os"
	"path/filepath"
	"testing"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/onsi/gomega"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/apiutil"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
)

var cfg1, cfg2 *rest.Config
var c1, c2 client.Client
var mapper1, mapper2 meta.RESTMapper

func TestMain(m *testing.M) {
	var err error
	t1 := &envtest.Environment{
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "..", "config", "crd", "bases")},
	}
	t2 := &envtest.Environment{
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "..", "config", "crd", "bases")},
	}

	err = osbv1alpha1.AddToScheme(scheme.Scheme)
	if err != nil {
		stdlog.Fatal(err)
	}

	err = resourcev1alpha1.AddToScheme(scheme.Scheme)
	if err != nil {
		stdlog.Fatal(err)
	}

	if cfg1, err = t1.Start(); err != nil {
		stdlog.Fatal(err)
	}
	defer t1.Stop()

	if cfg2, err = t2.Start(); err != nil {
		stdlog.Fatal(err)
	}
	defer t2.Stop()

	code := m.Run()
	os.Exit(code)
}

func setupClients(g *gomega.GomegaWithT) {
	var err error
	mapper1, err = apiutil.NewDiscoveryRESTMapper(cfg1)
	g.Expect(err).NotTo(gomega.HaveOccurred())

	c1, err = client.New(cfg1, client.Options{
		Scheme: scheme.Scheme,
		Mapper: mapper1,
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())

	mapper2, err = apiutil.NewDiscoveryRESTMapper(cfg2)
	g.Expect(err).NotTo(gomega.HaveOccurred())

	c2, err = client.New(cfg2, client.Options{
		Scheme: scheme.Scheme,
		Mapper: mapper2,
	})
	g.Expect(err).NotTo(gomega.HaveOccurred())
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
