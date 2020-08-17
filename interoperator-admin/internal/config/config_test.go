package config

import (
	"fmt"
	"os"
	"reflect"
	"testing"
)

type testArgs struct {
	expected *InteroperatorAdminConfig
}

func TestNewAdminConfig(t *testing.T) {
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name:    "returns new AdminConfig instance with default values",
			args:    testArgs{},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				args.expected = &InteroperatorAdminConfig{
					ServerPort: "9297",
					Username:   "admin",
					Password:   "secret",
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
			got := NewAdminConfig()
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
				args.expected = &InteroperatorAdminConfig{
					ServerPort: "9296",
					Username:   "admin",
					Password:   "admin",
				}
				os.Setenv("INTEROPERATOR_ADMIN_PORT", "9296")
				os.Setenv("INTEROPERATOR_ADMIN_PASSWORD", "admin")
			},
			cleanup: func(args *testArgs) {
				os.Unsetenv("INTEROPERATOR_ADMIN_PORT")
				os.Unsetenv("INTEROPERATOR_ADMIN_PASSWORD")
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
			got := NewAdminConfig()
			got.InitConfig()
			fmt.Println(os.Getenv("ServerPort"))
			if tt.want == true && !reflect.DeepEqual(got, tt.args.expected) {
				t.Errorf("Config Validation failed got %v, want %v", got, tt.args.expected)
			}
		})
	}
}
