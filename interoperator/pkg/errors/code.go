package errors

// Error codes
const (
	CodeSFServiceNotFound         = "SFServiceNotFound"
	CodeSFPlanNotFound            = "SFPlanNotFound"
	CodeSFServiceInstanceNotFound = "SFServiceInstanceNotFound"
	CodeSFServiceBindingNotFound  = "SFServiceBindingNotFound"
	CodeTemplateNotFound          = "TemplateNotFound"

	CodeOperationInProgress = "OperationInProgress"

	CodeRendererError = "RendererError"

	CodeClusterFactoryError = "ClusterFactoryError"

	CodeMarshalError   = "CodeMarshalError"
	CodeUnmarshalError = "CodeUnmarshalError"
	CodeConvertError   = "CodeConvertError"

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
