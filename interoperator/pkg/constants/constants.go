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
	PrimaryClusterKey                     = "interoperator.servicefabrik.io/primarycluster"
	ErrorThreshold                        = 10

	ConfigMapName           = "interoperator-config"
	ConfigMapKey            = "config"
	ProvisionerName         = "provisioner"
	ProvisionerTemplateName = "provisioner-template"

	NamespaceEnvKey    = "POD_NAMESPACE"
	OwnClusterIDEnvKey = "CLUSTER_ID"

	NamespaceLabelKey = "OWNER_INTEROPERATOR_NAMESPACE"

	MultiClusterWatchTimeout = 28800 // 8 hours in seconds

	DefaultInstanceWorkerCount    = 10
	DefaultBindingWorkerCount     = 20
	DefaultSchedulerWorkerCount   = 10
	DefaultProvisionerWorkerCount = 10
	DefaultPrimaryClusterID       = "1"

	GoTemplateType = "gotemplate"

	PlanWatchDrainTimeout           = time.Second * 2
	DefaultClusterReconcileInterval = "20m"

	ListPaginationLimit = 50
)

// Configs initialized at startup
var (
	InteroperatorNamespace = "default"
	OwnClusterID           = "1"   // "1" is the DefaultMasterClusterID
	K8SDeployment          = false // Set to true when POD_NAMESPACE env is set

	// used only in multiclusterdeploy build
	ReplicaCount = 1
)

func init() {
	interoperatorNamespace, ok := os.LookupEnv(NamespaceEnvKey)
	if ok {
		InteroperatorNamespace = interoperatorNamespace
		K8SDeployment = true
	}

	ownClusterID, ok := os.LookupEnv(OwnClusterIDEnvKey)
	if ok {
		OwnClusterID = ownClusterID
	}
}
