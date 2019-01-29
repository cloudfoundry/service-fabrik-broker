package main

import (
	"flag"
	"testing"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
	"k8s.io/client-go/rest"

	"sigs.k8s.io/controller-runtime/pkg/envtest"
)

var testenv *envtest.Environment
var tcfg *rest.Config

func TestManager(t *testing.T) {
	RegisterFailHandler(Fail)
	RunSpecs(t, "Manager Suite")
}

var _ = BeforeSuite(func(done Done) {
	// testenv = &envtest.Environment{}
	flag.Parse()

	var err error
	// tcfg, err = testenv.Start()
	Expect(err).NotTo(HaveOccurred())
	close(done)
}, 60)

var _ = AfterSuite(func() {
	// testenv.Stop()
})
