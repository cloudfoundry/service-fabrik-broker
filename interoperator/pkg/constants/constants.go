package constants

import (
	"os"
	"time"
)

// Constants used by interoperator
const (
	FinalizerName                         = "interoperator.servicefabrik.io"
	SFServiceInstanceCounterFinalizerName = "sfserviceinstancecounter.servicefabrik.io"
	ErrorCountKey                         = "interoperator.servicefabrik.io/error"
	LastOperationKey                      = "interoperator.servicefabrik.io/lastoperation"
	ErrorThreshold                        = 10

	ConfigMapName   = "interoperator-config"
	ConfigMapKey    = "config"
	ProvisionerName = "provisioner"

	NamespaceEnvKey    = "POD_NAMESPACE"
	OwnClusterIDEnvKey = "CLUSTER_ID"

	NamespaceLabelKey = "OWNER_INTEROPERATOR_NAMESPACE"

	MultiClusterWatchTimeout = 28800 // 8 hours in seconds

	DefaultInstanceWorkerCount    = 10
	DefaultBindingWorkerCount     = 20
	DefaultSchedulerWorkerCount   = 10
	DefaultProvisionerWorkerCount = 10

	DefaultSchedulerType = "default"

	LabelSelectorSchedulerType = "label-selector"
	GoTemplateType             = "gotemplate"

	PlanWatchDrainTimeout = time.Second * 2

	ListPaginationLimit = 50
)

// Configs initialized at startup
var (
	InteroperatorNamespace = "default"
	OwnClusterID           = "1" // "1" is the DefaultMasterClusterID
)

func init() {
	interoperatorNamespace, ok := os.LookupEnv(NamespaceEnvKey)
	if ok {
		InteroperatorNamespace = interoperatorNamespace
	}

	ownClusterID, ok := os.LookupEnv(OwnClusterIDEnvKey)
	if ok {
		OwnClusterID = ownClusterID
	}
}
