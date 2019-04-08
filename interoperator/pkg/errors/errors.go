package errors

import "fmt"

// InteroperatorError generic error implementation used by interoperator
type InteroperatorError struct {
	Err     error
	Code    ErrorCodeType
	Message string
}

// Error returns an error message describing 'e'.
func (e *InteroperatorError) Error() string {
	return e.Message
}

// NewClusterFactoryError returns new error indicating incorrect arguments passed.
func NewClusterFactoryError(message string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeClusterFactoryError,
		Message: message,
	}
}

// ClusterFactoryError checks whether error is of CodeClusterError type
func ClusterFactoryError(err error) bool {
	return ErrorCode(err) == CodeClusterFactoryError
}

// NewMarshalError returns new error indicating marshalling to specific format failed.
func NewMarshalError(message string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeMarshalError,
		Message: message,
	}
}

// MarshalError checks whether error is of CodeMarshalError type
func MarshalError(err error) bool {
	return ErrorCode(err) == CodeMarshalError
}

// NewUnmarshalError returns new error new error indicating unmarshalling from specific format failed.
func NewUnmarshalError(message string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeUnmarshalError,
		Message: message,
	}
}

// UnmarshalError checks whether error is of CodeUnmarshalError type
func UnmarshalError(err error) bool {
	return ErrorCode(err) == CodeUnmarshalError
}

// NewConvertError returns new error indicating error converting between formats
func NewConvertError(message string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeConvertError,
		Message: message,
	}
}

// ConvertError checks whether error is of CodeConvertError type
func ConvertError(err error) bool {
	return ErrorCode(err) == CodeConvertError
}

// NewSFServiceNotFound returns a new error which indicates that the SfService is not found.
func NewSFServiceNotFound(name string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeSFServiceNotFound,
		Message: fmt.Sprintf("SfService %s not found", name),
	}
}

// SFServiceNotFound is true if the error indicates the requested service is not found.
func SFServiceNotFound(err error) bool {
	return ErrorCode(err) == CodeSFServiceNotFound
}

// NewSFPlanNotFound returns a new error which indicates that the SfService is not found.
func NewSFPlanNotFound(name string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeSFPlanNotFound,
		Message: fmt.Sprintf("SfPlan %s not found", name),
	}
}

// SFPlanNotFound is true if the error indicates the requested service plan is not found.
func SFPlanNotFound(err error) bool {
	return ErrorCode(err) == CodeSFPlanNotFound
}

// NewSFServiceInstanceNotFound returns a new error which indicates that the SfService is not found.
func NewSFServiceInstanceNotFound(name string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeSFServiceInstanceNotFound,
		Message: fmt.Sprintf("SFServiceInstance %s not found", name),
	}
}

// SFServiceInstanceNotFound is true if the error indicates the requested service instance is not found.
func SFServiceInstanceNotFound(err error) bool {
	return ErrorCode(err) == CodeSFServiceInstanceNotFound
}

// NewSFServiceBindingNotFound returns a new error which indicates that the SfService is not found.
func NewSFServiceBindingNotFound(name string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeSFServiceBindingNotFound,
		Message: fmt.Sprintf("SFServiceBinding %s not found", name),
	}
}

// SFServiceBindingNotFound is true if the error indicates the requested service binding is not found.
func SFServiceBindingNotFound(err error) bool {
	return ErrorCode(err) == CodeSFServiceBindingNotFound
}

// NotFound is true if the error indicates any not found error
func NotFound(err error) bool {
	code := ErrorCode(err)
	return code == CodeSFServiceNotFound ||
		code == CodeSFPlanNotFound ||
		code == CodeSFServiceInstanceNotFound ||
		code == CodeSFServiceBindingNotFound ||
		code == CodeTemplateNotFound
}

// NewOperationInProgress returns a new error which indicates that some operation is progress.
func NewOperationInProgress(name string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeOperationInProgress,
		Message: fmt.Sprintf("Some operation is in progress for resource %s", name),
	}
}

// OperationInProgress is true if the error indicates the requested service binding is not found.
func OperationInProgress(err error) bool {
	return ErrorCode(err) == CodeOperationInProgress
}

// NewRendererError returns a new error which indicates renderer error
func NewRendererError(rendererType, message string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeRendererError,
		Message: fmt.Sprintf("%s renderer - %s", rendererType, message),
	}
}

// RendererError is true if the error indicates renderer error.
func RendererError(err error) bool {
	return ErrorCode(err) == CodeRendererError
}

// NewTemplateNotFound returns a new error which indicates plan template mot found
func NewTemplateNotFound(name, planID string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeTemplateNotFound,
		Message: fmt.Sprintf("%s template not found for plan %s", name, planID),
	}
}

// TemplateNotFound is true if the error indicates TemplateNotFound error.
func TemplateNotFound(err error) bool {
	return ErrorCode(err) == CodeTemplateNotFound
}

// NewInputError returns a new error which indicates plan template mot found
func NewInputError(fn, inputs string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeInputError,
		Message: fmt.Sprintf("invalid inputs %s to function %s", inputs, fn),
	}
}

// InputError is true if the error indicates an InputError.
func InputError(err error) bool {
	return ErrorCode(err) == CodeInputError
}
