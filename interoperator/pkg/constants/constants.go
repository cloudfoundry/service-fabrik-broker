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
	OwnClusterIDEnvKey = "CLUSTER_ID"
	MasterClusterID    = "1"
	StatefulSetName    = "web"

	MultiClusterWatchTimeout = 28800 // 8 hours in seconds

	DefaultServiceFabrikNamespace = "default"
	DefaultInstanceWorkerCount    = 10
	DefaultBindingWorkerCount     = 20
	DefaultSchedulerWorkerCount   = 10
	DefaultSchedulerType          = "bosh"
	RoundRobinSchedulerType       = "round-robin"
)
