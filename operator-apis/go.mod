module github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis

go 1.15

require (
	github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator v0.0.0-00010101000000-000000000000 // indirect
	github.com/go-logr/logr v0.3.0
	github.com/gophercloud/gophercloud v0.1.0 // indirect
	github.com/gorilla/mux v1.8.0
	github.com/jessevdk/go-flags v1.4.0 // indirect
	github.com/onsi/ginkgo v1.14.2
	github.com/onsi/gomega v1.10.3
	k8s.io/api v0.19.2
	k8s.io/apimachinery v0.19.2
	k8s.io/client-go v0.19.2
	k8s.io/klog v1.0.0 // indirect
	sigs.k8s.io/controller-runtime v0.7.0
	sigs.k8s.io/structured-merge-diff/v3 v3.0.0 // indirect
)

replace github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator => ../interoperator
