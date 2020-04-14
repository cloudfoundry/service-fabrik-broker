module github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator

go 1.13

require (
	github.com/Masterminds/sprig/v3 v3.0.2
	github.com/go-logr/logr v0.1.0
	github.com/golang/mock v1.2.0
	github.com/onsi/ginkgo v1.10.1
	github.com/onsi/gomega v1.7.0
	gopkg.in/yaml.v2 v2.2.4
	helm.sh/helm/v3 v3.1.1
	k8s.io/api v0.17.2
	k8s.io/apiextensions-apiserver v0.17.2
	k8s.io/apimachinery v0.17.2
	k8s.io/client-go v0.17.2
	k8s.io/code-generator v0.17.2
	sigs.k8s.io/controller-runtime v0.4.0
)

replace (
	github.com/Azure/go-autorest => github.com/Azure/go-autorest v13.3.2+incompatible
	github.com/docker/distribution => github.com/docker/distribution v0.0.0-20191216044856-a8371794149d
)
