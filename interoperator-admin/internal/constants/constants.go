package constants

// Constants used in the Interoperator admin app
const (
	DelayBetweenBatchUpdates = 2
	ServerDefaultPort        = 9297
	ServerDefaultUsername    = "admin"
	ServerDefaultPassword    = "secret"
	InteroperatorNamespace   = "default"
	AdminConfigMapName       = "interoperator-admin-config"
	AdminConfigMapKey        = "config"
)

// SupportedQueryKeysToLabels holds supported query keys for get and patch APIs and it's mapping
// to corresponding sfserviceinstance labels
var SupportedQueryKeysToLabels = map[string]string{
	"service": "service_id",
	"plan":    "plan_id",
}
