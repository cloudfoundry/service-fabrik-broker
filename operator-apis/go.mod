module github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis

go 1.15

require (
	github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator v0.0.0-00010101000000-000000000000
	github.com/go-logr/logr v0.4.0
	github.com/gorilla/mux v1.8.0
	github.com/onsi/ginkgo v1.16.4
	github.com/onsi/gomega v1.14.0
	k8s.io/api v0.21.3
	k8s.io/apimachinery v0.21.3
	k8s.io/client-go v0.21.3
	sigs.k8s.io/controller-runtime v0.9.6
)

replace github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator => ../interoperator
