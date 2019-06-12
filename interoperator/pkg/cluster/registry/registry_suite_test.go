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

package registry

import (
	stdlog "log"
	"os"
	"path/filepath"
	"testing"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis"

	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/apiutil"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
)

var kubeConfig *rest.Config
var c client.Client
var sch *runtime.Scheme
var mapper meta.RESTMapper

func TestMain(m *testing.M) {
	var err error
	t := &envtest.Environment{
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "..", "config", "crds")},
	}
	apis.AddToScheme(scheme.Scheme)
	if kubeConfig, err = t.Start(); err != nil {
		stdlog.Fatal(err)
	}

	mapper, err = apiutil.NewDiscoveryRESTMapper(kubeConfig)
	if err != nil {
		stdlog.Fatal(err)
	}

	if c, err = client.New(kubeConfig, client.Options{
		Scheme: scheme.Scheme,
		Mapper: mapper,
	}); err != nil {
		stdlog.Fatal(err)
	}
	sch = scheme.Scheme

	logf.SetLogger(logf.ZapLogger(false))
	code := m.Run()
	t.Stop()
	os.Exit(code)
}
