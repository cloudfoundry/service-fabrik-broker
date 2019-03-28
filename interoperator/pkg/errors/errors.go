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

// IsClusterFactoryError checks whether error is of CodeClusterError type
func IsClusterFactoryError(err error) bool {
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

// IsMarshalError checks whether error is of CodeMarshalError type
func IsMarshalError(err error) bool {
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

// IsUnmarshalError checks whether error is of CodeUnmarshalError type
func IsUnmarshalError(err error) bool {
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

// IsConvertError checks whether error is of CodeConvertError type
func IsConvertError(err error) bool {
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

// IsSFServiceNotFound is true if the error indicates the requested service is not found.
func IsSFServiceNotFound(err error) bool {
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

// IsSFPlanNotFound is true if the error indicates the requested service plan is not found.
func IsSFPlanNotFound(err error) bool {
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

// IsSFServiceInstanceNotFound is true if the error indicates the requested service instance is not found.
func IsSFServiceInstanceNotFound(err error) bool {
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

// IsSFServiceBindingNotFound is true if the error indicates the requested service binding is not found.
func IsSFServiceBindingNotFound(err error) bool {
	return ErrorCode(err) == CodeSFServiceBindingNotFound
}

// IsNotFound is true if the error indicates any not found error
func IsNotFound(err error) bool {
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

// IsOperationInProgress is true if the error indicates the requested service binding is not found.
func IsOperationInProgress(err error) bool {
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

// IsRendererError is true if the error indicates renderer error.
func IsRendererError(err error) bool {
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

// IsTemplateNotFound is true if the error indicates TemplateNotFound error.
func IsTemplateNotFound(err error) bool {
	return ErrorCode(err) == CodeTemplateNotFound
}
