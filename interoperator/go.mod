module github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator

go 1.15

require (
	github.com/BurntSushi/toml v0.3.1
	github.com/Masterminds/sprig/v3 v3.2.2
	github.com/go-logr/logr v0.1.0
	github.com/golang/mock v1.4.4
	github.com/onsi/ginkgo v1.16.5
	github.com/onsi/gomega v1.10.3
	github.com/prometheus/client_golang v1.8.0
	helm.sh/helm/v3 v3.6.1
	k8s.io/api v0.21.0
	k8s.io/apiextensions-apiserver v0.21.0
	k8s.io/apimachinery v0.21.0
	k8s.io/client-go v0.21.0
	k8s.io/code-generator v0.21.0
	sigs.k8s.io/controller-runtime v0.6.3
	sigs.k8s.io/yaml v1.2.0
)

replace (
	github.com/Azure/go-autorest => github.com/Azure/go-autorest v13.3.2+incompatible
	github.com/docker/distribution => github.com/docker/distribution v0.0.0-20191216044856-a8371794149d
	k8s.io/api => k8s.io/api v0.18.8
	k8s.io/apiextensions-apiserver => k8s.io/apiextensions-apiserver v0.18.8
	k8s.io/apimachinery => k8s.io/apimachinery v0.18.8
	k8s.io/apiserver => k8s.io/apiserver v0.18.8
	k8s.io/cli-runtime => k8s.io/cli-runtime v0.18.8
	k8s.io/client-go => k8s.io/client-go v0.18.8
	k8s.io/code-generator => k8s.io/code-generator v0.18.8
	k8s.io/component-base => k8s.io/component-base v0.18.8
	k8s.io/component-helpers => k8s.io/component-helpers v0.18.8
	k8s.io/gengo => k8s.io/gengo v0.0.0-20200114144118-36b2048a9120
	k8s.io/klog/v2 => k8s.io/klog/v2 v2.0.0
	k8s.io/kube-openapi => k8s.io/kube-openapi v0.0.0-20200410145947-bcb3869e6f29
	k8s.io/kubectl => k8s.io/kubectl v0.18.8
	k8s.io/metrics => k8s.io/metrics v0.18.8
	k8s.io/utils => k8s.io/utils v0.0.0-20200619165400-6e3d28b6ed19
)
