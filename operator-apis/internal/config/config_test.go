package config

import (
	"os"
	"reflect"
	"testing"

	"k8s.io/client-go/rest"
)

type testArgs struct {
	expected *OperatorApisConfig
}

func TestNewOperatorApisConfig(t *testing.T) {
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name:    "returns new OperatorApisConfig instance with default values",
			args:    testArgs{},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				args.expected = &OperatorApisConfig{
					ServerPort:      "9297",
					Username:        "admin",
					Password:        "secret",
					Kubeconfig:      &rest.Config{},
					DefaultPageSize: 5,
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup(&tt.args)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(&tt.args)
			}
			got := NewOperatorApisConfig(&rest.Config{})
			if tt.want == true && !reflect.DeepEqual(got, tt.args.expected) {
				t.Errorf("Config Validation failed got %v, want %v", got, tt.args.expected)
			}
		})
	}
}

func Test_config_InitConfig(t *testing.T) {
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name:    "Initializes config values from environment",
			args:    testArgs{},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				args.expected = &OperatorApisConfig{
					ServerPort:      "9296",
					Username:        "admin",
					Password:        "admin",
					Kubeconfig:      &rest.Config{},
					DefaultPageSize: 5,
				}
				os.Setenv("OPERATOR_APIS_APP_PORT", "9296")
				os.Setenv("OPERATOR_APIS_APP_USERNAME", "admin")
				os.Setenv("OPERATOR_APIS_APP_PASSWORD", "admin")
				os.Setenv("OPERATOR_APIS_APP_PAGE_SIZE", "5")
			},
			cleanup: func(args *testArgs) {
				os.Unsetenv("OPERATOR_APIS_APP_PORT")
				os.Unsetenv("OPERATOR_APIS_APP_PASSWORD")
			},
		},
		{
			name:    "Handles invalid config values from environment",
			args:    testArgs{},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				args.expected = &OperatorApisConfig{
					ServerPort:      "9296",
					Username:        "admin",
					Password:        "admin",
					Kubeconfig:      &rest.Config{},
					DefaultPageSize: 5,
				}
				os.Setenv("OPERATOR_APIS_APP_PORT", "9296")
				os.Setenv("OPERATOR_APIS_APP_USERNAME", "admin")
				os.Setenv("OPERATOR_APIS_APP_PASSWORD", "admin")
				os.Setenv("OPERATOR_APIS_APP_PAGE_SIZE", "six")
			},
			cleanup: func(args *testArgs) {
				os.Unsetenv("OPERATOR_APIS_APP_PORT")
				os.Unsetenv("OPERATOR_APIS_APP_PASSWORD")
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.setup != nil {
				tt.setup(&tt.args)
			}
			if tt.cleanup != nil {
				defer tt.cleanup(&tt.args)
			}
			got := NewOperatorApisConfig(&rest.Config{})
			got.InitConfig()
			if tt.want == true && !reflect.DeepEqual(got, tt.args.expected) {
				t.Errorf("Config Validation failed got %v, want %v", got, tt.args.expected)
			}
		})
	}
}
