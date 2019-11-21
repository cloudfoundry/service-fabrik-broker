package errors

// Error codes
const (
	CodeSFServiceNotFound         = "SFServiceNotFound"
	CodeSFPlanNotFound            = "SFPlanNotFound"
	CodeSFServiceInstanceNotFound = "SFServiceInstanceNotFound"
	CodeSFServiceBindingNotFound  = "SFServiceBindingNotFound"
	CodeSFClusterNotFound         = "SFClusterNotFound"
	CodeTemplateNotFound          = "TemplateNotFound"
	CodeSchedulerFailed           = "CodeSchedulerFailed"

	CodeOperationInProgress = "OperationInProgress"

	CodeRendererError = "RendererError"

	CodeClusterRegistryError = "ClusterRegistryError"
	CodeClusterIDNotSet      = "ClusterIDNotSet"

	CodeInputError        = "CodeInputError"
	CodeMarshalError      = "CodeMarshalError"
	CodeUnmarshalError    = "CodeUnmarshalError"
	CodeConvertError      = "CodeConvertError"
	CodePreconditionError = "CodePreconditionError"

	CodeUnknown = "Unknown"
)

// ErrorCodeType is the type for error codes
type ErrorCodeType string

// ErrorCode returns the HTTP status for a particular error.
func ErrorCode(err error) ErrorCodeType {
	if err == nil {
		return CodeUnknown
	}
	switch t := err.(type) {
	case *InteroperatorError:
		return t.Code
	}
	return CodeUnknown
}
