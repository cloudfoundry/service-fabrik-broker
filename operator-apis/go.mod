module github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis

go 1.15

require (
	github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator v0.0.0-20200714073818-30941c89fc78
	github.com/go-logr/logr v0.1.0
	github.com/gorilla/mux v1.7.4
	github.com/onsi/ginkgo v1.12.1
	github.com/onsi/gomega v1.10.1
	k8s.io/apimachinery v0.18.6
	k8s.io/client-go v0.18.6
	sigs.k8s.io/controller-runtime v0.6.3
)
