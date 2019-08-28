package constants

// Constants used by interoperator
const (
	FinalizerName    = "interoperator.servicefabrik.io"
	ErrorCountKey    = "interoperator.servicefabrik.io/error"
	LastOperationKey = "interoperator.servicefabrik.io/lastoperation"
	ErrorThreshold   = 10

	ConfigMapName      = "interoperator-config"
	ConfigMapKey       = "config"
	NamespaceEnvKey    = "POD_NAMESPACE"
	OwnClusterIDEnvKey = "OwnClusterID"
	MasterClusterID    = "1"
	StatefulSetName    = "provisioner"

	DefaultServiceFabrikNamespace = "default"
	DefaultInstanceWorkerCount    = 10
	DefaultBindingWorkerCount     = 20
	DefaultSchedulerWorkerCount   = 10
	ProvisionerWorkerCount        = 10
	DefaultSchedulerType          = "bosh"
	RoundRobinSchedulerType       = "round-robin"
)
