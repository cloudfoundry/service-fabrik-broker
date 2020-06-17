/*
Copyright 2019 The Service Fabrik Authors.

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

package sfclusterreplicator

import (
	"path/filepath"
	"sync"
	"testing"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	mock_clusterRegistry "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry/mock_registry"
	"github.com/golang/mock/gomock"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/envtest"
	"sigs.k8s.io/controller-runtime/pkg/envtest/printer"
	"sigs.k8s.io/controller-runtime/pkg/event"
	logf "sigs.k8s.io/controller-runtime/pkg/log"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"
	// +kubebuilder:scaffold:imports
)

// These tests use Ginkgo (BDD-style Go testing framework). Refer to
// http://onsi.github.io/ginkgo/ to learn more about Ginkgo.

var cfg, cfg2 *rest.Config
var k8sClient, k8sClient2 client.Client
var testEnv, testEnv2 *envtest.Environment
var k8sManager ctrl.Manager

var (
	mockClusterRegistry *mock_clusterRegistry.MockClusterRegistry
	watchChannel        chan event.GenericEvent
	stopMgr             chan struct{}
	mgrStopped          *sync.WaitGroup
	_getWatchChannel    func(string) (<-chan event.GenericEvent, error)
)

func TestAPIs(t *testing.T) {
	RegisterFailHandler(Fail)

	RunSpecsWithDefaultAndCustomReporters(t,
		"Cluster Replicator Suite",
		[]Reporter{printer.NewlineReporter{}})
}

var _ = BeforeSuite(func(done Done) {
	logf.SetLogger(zap.LoggerTo(GinkgoWriter, true))

	By("bootstrapping test environment")
	testEnv = &envtest.Environment{
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "..", "config", "crd", "bases")},
	}
	testEnv2 = &envtest.Environment{
		CRDDirectoryPaths: []string{filepath.Join("..", "..", "..", "config", "crd", "bases")},
	}

	var err error
	cfg, err = testEnv.Start()
	Expect(err).ToNot(HaveOccurred())
	Expect(cfg).ToNot(BeNil())

	cfg2, err = testEnv2.Start()
	Expect(err).ToNot(HaveOccurred())
	Expect(cfg2).ToNot(BeNil())

	err = resourcev1alpha1.AddToScheme(scheme.Scheme)
	Expect(err).NotTo(HaveOccurred())

	k8sClient, err = client.New(cfg, client.Options{Scheme: scheme.Scheme})
	Expect(err).ToNot(HaveOccurred())
	Expect(k8sClient).ToNot(BeNil())

	k8sClient2, err = client.New(cfg2, client.Options{Scheme: scheme.Scheme})
	Expect(err).ToNot(HaveOccurred())
	Expect(k8sClient2).ToNot(BeNil())

	k8sManager, err = ctrl.NewManager(cfg, ctrl.Options{
		Scheme:             scheme.Scheme,
		MetricsBindAddress: "0",
	})
	Expect(err).ToNot(HaveOccurred())

	_getWatchChannel = getWatchChannel
	mockCtrl := gomock.NewController(GinkgoT())
	mockClusterRegistry = mock_clusterRegistry.NewMockClusterRegistry(mockCtrl)
	controller := &SFClusterReplicator{
		Client:          k8sClient,
		Scheme:          scheme.Scheme,
		clusterRegistry: mockClusterRegistry,
	}

	watchChannel = make(chan event.GenericEvent)
	getWatchChannel = func(controllerName string) (<-chan event.GenericEvent, error) {
		return watchChannel, nil
	}

	Expect(controller.SetupWithManager(k8sManager)).Should(Succeed())
	stopMgr, mgrStopped = StartTestManager()

	close(done)
}, 60)

var _ = AfterSuite(func(done Done) {
	By("tearing down the test environment")

	close(stopMgr)
	mgrStopped.Wait()

	getWatchChannel = _getWatchChannel

	err := testEnv.Stop()
	Expect(err).ToNot(HaveOccurred())

	err = testEnv2.Stop()
	Expect(err).ToNot(HaveOccurred())

	close(done)
})

// StartTestManager starts the manager and returns the stop channel
func StartTestManager() (chan struct{}, *sync.WaitGroup) {
	stop := make(chan struct{})
	wg := &sync.WaitGroup{}
	wg.Add(1)
	go func() {
		defer wg.Done()
		Expect(k8sManager.Start(stop)).NotTo(HaveOccurred())
	}()
	return stop, wg
}
