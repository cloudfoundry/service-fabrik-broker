module github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin

go 1.13

require (
	github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator v0.0.0-20200714073818-30941c89fc78
	github.com/google/martian v2.1.0+incompatible
	github.com/gorilla/mux v1.7.4
	go.etcd.io/etcd v0.0.0-20191023171146-3cf2f69b5738
	gopkg.in/yaml.v1 v1.0.0-20140924161607-9f9df34309c0
	k8s.io/api v0.17.2
	k8s.io/apimachinery v0.17.2
	k8s.io/client-go v0.17.2
	sigs.k8s.io/controller-runtime v0.5.3
)
