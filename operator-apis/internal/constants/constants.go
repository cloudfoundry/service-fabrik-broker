package constants

// Constants used in the Operator APIs app
const (
	DelayBetweenBatchUpdates = 2
	DefaultPort              = "9297"
	DefaultUsername          = "admin"
	DefaultPassword          = "secret"
	PortConfigKey            = "OPERATOR_APIS_APP_PORT"
	UsernameConfigKey        = "OPERATOR_APIS_APP_USERNAME"
	PasswordConfigKey        = "OPERATOR_APIS_APP_PASSWORD"
	PageSizeKey              = "OPERATOR_APIS_APP_PAGE_SIZE"
	DefaultPageSize          = 5
)

// SupportedQueryKeysToLabels holds supported query keys for get and patch APIs and it's mapping
// to corresponding sfserviceinstance labels
var SupportedQueryKeysToLabels = map[string]string{
	"service": "service_id",
	"plan":    "plan_id",
}
