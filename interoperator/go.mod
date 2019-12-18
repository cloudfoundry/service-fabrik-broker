module github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator

go 1.13

require (
	github.com/Masterminds/sprig/v3 v3.0.2
	github.com/go-logr/logr v0.1.0
	github.com/golang/mock v1.2.0
	github.com/onsi/ginkgo v1.10.1
	github.com/onsi/gomega v1.7.0
	gopkg.in/yaml.v2 v2.2.4
	helm.sh/helm/v3 v3.0.2
	k8s.io/api v0.0.0-20191016110408-35e52d86657a
	k8s.io/apiextensions-apiserver v0.0.0-20191016113550-5357c4baaf65
	k8s.io/apimachinery v0.0.0-20191004115801-a2eda9f80ab8
	k8s.io/client-go v0.0.0-20191016111102-bec269661e48
	k8s.io/code-generator v0.0.0-20191004115455-8e001e5d1894
	sigs.k8s.io/controller-runtime v0.4.0
)

replace (
	// This section is copied from helm.sh/helm/v3
	// github.com/Azure/go-autorest/autorest has different versions for the Go
	// modules than it does for releases on the repository. Note the correct
	// version when updating.
	github.com/Azure/go-autorest/autorest => github.com/Azure/go-autorest/autorest v0.9.0
	github.com/deislabs/oras => github.com/deislabs/oras v0.8.0
	github.com/docker/docker => github.com/moby/moby v0.7.3-0.20190826074503-38ab9da00309
	gopkg.in/inf.v0 v0.9.1 => github.com/go-inf/inf v0.9.1
	rsc.io/letsencrypt => github.com/dmcgowan/letsencrypt v0.0.0-20160928181947-1847a81d2087
)
