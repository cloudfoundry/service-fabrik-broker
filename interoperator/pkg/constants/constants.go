package constants

import (
	"time"
)

// Constants used by interoperator
const (
	LeaderElectionID   = "interoperator-leader-election-helper"
	FinalizerName      = "interoperator.servicefabrik.io"
	ErrorCountKey      = "interoperator.servicefabrik.io/error"
	LastOperationKey   = "interoperator.servicefabrik.io/lastoperation"
	OwnerNameKey       = "interoperator.servicefabrik.io/ownername"
	OwnerNamespaceKey  = "interoperator.servicefabrik.io/ownernamespace"
	OwnerKindKey       = "interoperator.servicefabrik.io/ownerkind"
	OwnerAPIVersionKey = "interoperator.servicefabrik.io/ownerapiversion"
	ErrorThreshold     = 10

	ConfigMapName   = "interoperator-config"
	ConfigMapKey    = "config"
	NamespaceEnvKey = "POD_NAMESPACE"

	DynamicWatchTimeout = 28800 // 8 hours in seconds

	DefaultServiceFabrikNamespace = "default"
	DefaultInstanceWorkerCount    = 10
	DefaultBindingWorkerCount     = 20
	DefaultSchedulerWorkerCount   = 10
	DefaultClusterID              = "1"

	ChannelDrainTimeout = time.Millisecond * 500
)
