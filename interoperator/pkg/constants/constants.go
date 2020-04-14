package constants

import (
	"time"
)

// Constants used by interoperator
const (
	FinalizerName                         = "interoperator.servicefabrik.io"
	SFServiceInstanceCounterFinalizerName = "sfserviceinstancecounter.servicefabrik.io"
	ErrorCountKey                         = "interoperator.servicefabrik.io/error"
	LastOperationKey                      = "interoperator.servicefabrik.io/lastoperation"
	ErrorThreshold                        = 10

	ConfigMapName          = "interoperator-config"
	ConfigMapKey           = "config"
	NamespaceEnvKey        = "POD_NAMESPACE"
	OwnClusterIDEnvKey     = "CLUSTER_ID"
	DefaultMasterClusterID = "1"
	ProvisionerName        = "provisioner"

	MultiClusterWatchTimeout = 28800 // 8 hours in seconds

	DefaultServiceFabrikNamespace = "default"
	DefaultInstanceWorkerCount    = 10
	DefaultBindingWorkerCount     = 20
	DefaultSchedulerWorkerCount   = 10
	DefaultProvisionerWorkerCount = 10

	DefaultSchedulerType       = "default"
	LabelSelectorSchedulerType = "label-selector"
	GoTemplateType             = "gotemplate"

	PlanWatchDrainTimeout = time.Second * 2
)
