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
	if e.Err != nil {
		return e.Message + ". " + e.Err.Error()
	}
	return e.Message
}

// NewClusterRegistryError returns new error indicating incorrect arguments passed.
func NewClusterRegistryError(message string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeClusterRegistryError,
		Message: message,
	}
}

// ClusterRegistryError checks whether error is of CodeClusterError type
func ClusterRegistryError(err error) bool {
	return ErrorCode(err) == CodeClusterRegistryError
}

// NewClusterIDNotSet returns new error indicating clusterID is not set for the instance
func NewClusterIDNotSet(name string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeClusterIDNotSet,
		Message: fmt.Sprintf("ClusterID is not set for SFServiceInstance %s", name),
	}
}

// ClusterIDNotSet checks whether error is of CodeClusterError type
func ClusterIDNotSet(err error) bool {
	return ErrorCode(err) == CodeClusterIDNotSet
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

// NewSFClusterNotFound returns a new error which indicates that the SfService is not found.
func NewSFClusterNotFound(name string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeSFClusterNotFound,
		Message: fmt.Sprintf("SFCluster %s not found", name),
	}
}

// SFClusterNotFound is true if the error indicates the requested cluster object is not found.
func SFClusterNotFound(err error) bool {
	return ErrorCode(err) == CodeSFClusterNotFound
}

// NotFound is true if the error indicates any not found error
func NotFound(err error) bool {
	code := ErrorCode(err)
	return code == CodeSFServiceNotFound ||
		code == CodeSFPlanNotFound ||
		code == CodeSFServiceInstanceNotFound ||
		code == CodeSFServiceBindingNotFound ||
		code == CodeSFClusterNotFound ||
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

// NewTemplateNotFound returns a new error which indicates plan template not found
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

// NewInputError returns a new error which indicates error in args to a functions
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

// NewPreconditionError returns a new error which indicates precondition not met
func NewPreconditionError(fn, message string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodePreconditionError,
		Message: fmt.Sprintf("precondition for function %s not met. %s", fn, message),
	}
}

// PreconditionError is true if the error indicates an PreconditionError.
func PreconditionError(err error) bool {
	return ErrorCode(err) == CodePreconditionError
}

// NewSchedulerFailed returns a new error which indicates that scheduler failed
func NewSchedulerFailed(schedulerType, message string, err error) *InteroperatorError {
	return &InteroperatorError{
		Err:     err,
		Code:    CodeSchedulerFailed,
		Message: fmt.Sprintf("scheduling with scheduler type %s failed. %s", schedulerType, message),
	}
}

// SchedulerFailed is true if the error indicates an SchedulerFailed.
func SchedulerFailed(err error) bool {
	return ErrorCode(err) == CodeSchedulerFailed
}
