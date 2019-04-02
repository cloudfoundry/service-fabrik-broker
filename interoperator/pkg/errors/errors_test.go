package errors

import (
	"fmt"
	"reflect"
	"testing"
)

var message = "some message"
var name = "name"

func TestInteroperatorError_Error(t *testing.T) {
	type fields struct {
		Err     error
		Code    ErrorCodeType
		Message string
	}
	tests := []struct {
		name   string
		fields fields
		want   string
	}{
		{
			name: "return message",
			fields: fields{
				Err:     nil,
				Code:    CodeUnknown,
				Message: message,
			},
			want: message,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := &InteroperatorError{
				Err:     tt.fields.Err,
				Code:    tt.fields.Code,
				Message: tt.fields.Message,
			}
			if got := e.Error(); got != tt.want {
				t.Errorf("InteroperatorError.Error() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewClusterFactoryError(t *testing.T) {
	type args struct {
		message string
		err     error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return ClusterFactoryError",
			args: args{
				message: message,
				err:     nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeClusterFactoryError,
				Message: message,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewClusterFactoryError(tt.args.message, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewClusterFactoryError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestClusterFactoryError(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if ClusterFactoryError",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeClusterFactoryError,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not ClusterFactoryError",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClusterFactoryError(tt.args.err); got != tt.want {
				t.Errorf("IsClusterFactoryError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewMarshalError(t *testing.T) {
	type args struct {
		message string
		err     error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return MarshalError",
			args: args{
				message: message,
				err:     nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeMarshalError,
				Message: message,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewMarshalError(tt.args.message, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewMarshalError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestMarshalError(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if MarshalError",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeMarshalError,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not MarshalError",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := MarshalError(tt.args.err); got != tt.want {
				t.Errorf("IsMarshalError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewUnmarshalError(t *testing.T) {
	type args struct {
		message string
		err     error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return UnmarshalError",
			args: args{
				message: message,
				err:     nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeUnmarshalError,
				Message: message,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewUnmarshalError(tt.args.message, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewUnmarshalError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestUnmarshalError(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if UnmarshalError",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnmarshalError,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not UnmarshalError",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := UnmarshalError(tt.args.err); got != tt.want {
				t.Errorf("IsUnmarshalError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewConvertError(t *testing.T) {
	type args struct {
		message string
		err     error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return ConvertError",
			args: args{
				message: message,
				err:     nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeConvertError,
				Message: message,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewConvertError(tt.args.message, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewConvertError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestConvertError(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if ConvertError",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeConvertError,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not ConvertError",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ConvertError(tt.args.err); got != tt.want {
				t.Errorf("IsConvertError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewSFServiceNotFound(t *testing.T) {
	type args struct {
		name string
		err  error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return SFServiceNotFound",
			args: args{
				name: name,
				err:  nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeSFServiceNotFound,
				Message: fmt.Sprintf("SfService %s not found", name),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewSFServiceNotFound(tt.args.name, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewSFServiceNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSFServiceNotFound(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if SFServiceNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeSFServiceNotFound,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not SFServiceNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SFServiceNotFound(tt.args.err); got != tt.want {
				t.Errorf("IsSFServiceNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewSFPlanNotFound(t *testing.T) {
	type args struct {
		name string
		err  error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return SFPlanNotFound",
			args: args{
				name: name,
				err:  nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeSFPlanNotFound,
				Message: fmt.Sprintf("SfPlan %s not found", name),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewSFPlanNotFound(tt.args.name, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewSFPlanNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSFPlanNotFound(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if SFPlanNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeSFPlanNotFound,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not SFPlanNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SFPlanNotFound(tt.args.err); got != tt.want {
				t.Errorf("IsSFPlanNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewSFServiceInstanceNotFound(t *testing.T) {
	type args struct {
		name string
		err  error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return SFServiceInstanceNotFound",
			args: args{
				name: name,
				err:  nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeSFServiceInstanceNotFound,
				Message: fmt.Sprintf("SFServiceInstance %s not found", name),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewSFServiceInstanceNotFound(tt.args.name, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewSFServiceInstanceNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSFServiceInstanceNotFound(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if SFServiceInstanceNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeSFServiceInstanceNotFound,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not SFServiceInstanceNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SFServiceInstanceNotFound(tt.args.err); got != tt.want {
				t.Errorf("IsSFServiceInstanceNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewSFServiceBindingNotFound(t *testing.T) {
	type args struct {
		name string
		err  error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return SFServiceBindingNotFound",
			args: args{
				name: name,
				err:  nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeSFServiceBindingNotFound,
				Message: fmt.Sprintf("SFServiceBinding %s not found", name),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewSFServiceBindingNotFound(tt.args.name, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewSFServiceBindingNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSFServiceBindingNotFound(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if SFServiceBindingNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeSFServiceBindingNotFound,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not SFServiceBindingNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := SFServiceBindingNotFound(tt.args.err); got != tt.want {
				t.Errorf("IsSFServiceBindingNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNotFound(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if IsNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeSFServiceBindingNotFound,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not IsNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeRendererError,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NotFound(tt.args.err); got != tt.want {
				t.Errorf("IsNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewOperationInProgress(t *testing.T) {
	type args struct {
		name string
		err  error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return OperationInProgress",
			args: args{
				name: name,
				err:  nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeOperationInProgress,
				Message: fmt.Sprintf("Some operation is in progress for resource %s", name),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewOperationInProgress(tt.args.name, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewOperationInProgress() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestOperationInProgress(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if OperationInProgress",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeOperationInProgress,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not OperationInProgress",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := OperationInProgress(tt.args.err); got != tt.want {
				t.Errorf("IsOperationInProgress() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewRendererError(t *testing.T) {
	type args struct {
		rendererType string
		message      string
		err          error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return RendererError",
			args: args{
				rendererType: name,
				message:      message,
				err:          nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeRendererError,
				Message: fmt.Sprintf("%s renderer - %s", name, message),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewRendererError(tt.args.rendererType, tt.args.message, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewRendererError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRendererError(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if RendererError",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeRendererError,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not RendererError",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := RendererError(tt.args.err); got != tt.want {
				t.Errorf("IsRendererError() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewTemplateNotFound(t *testing.T) {
	type args struct {
		name   string
		planID string
		err    error
	}
	tests := []struct {
		name string
		args args
		want *InteroperatorError
	}{
		{
			name: "return TemplateNotFound",
			args: args{
				name:   name,
				planID: message,
				err:    nil,
			},
			want: &InteroperatorError{
				Err:     nil,
				Code:    CodeTemplateNotFound,
				Message: fmt.Sprintf("%s template not found for plan %s", name, message),
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewTemplateNotFound(tt.args.name, tt.args.planID, tt.args.err); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewTemplateNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestTemplateNotFound(t *testing.T) {
	type args struct {
		err error
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "return true if TemplateNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeTemplateNotFound,
					Message: message,
				},
			},
			want: true,
		},
		{
			name: "return false if not TemplateNotFound",
			args: args{
				err: &InteroperatorError{
					Err:     nil,
					Code:    CodeUnknown,
					Message: message,
				},
			},
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := TemplateNotFound(tt.args.err); got != tt.want {
				t.Errorf("IsTemplateNotFound() = %v, want %v", got, tt.want)
			}
		})
	}
}
