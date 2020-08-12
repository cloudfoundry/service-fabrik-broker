package constants

// Constants used in the Interoperator admin app
const (
	DelayBetweenBatchUpdates = 2
	DefaultPort              = "9297"
	DefaultUsername          = "admin"
	DefaultPassword          = "secret"
	PortConfigKey            = "INTEROPERATOR_ADMIN_PORT"
	UsernameConfigKey        = "INTEROPERATOR_ADMIN_USERNAME"
	PasswordConfigKey        = "INTEROPERATOR_ADMIN_PASSWORD"
)

// SupportedQueryKeysToLabels holds supported query keys for get and patch APIs and it's mapping
// to corresponding sfserviceinstance labels
var SupportedQueryKeysToLabels = map[string]string{
	"service": "service_id",
	"plan":    "plan_id",
}
