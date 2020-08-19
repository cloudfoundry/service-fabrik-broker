package middlewares

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/config"
	"github.com/gorilla/mux"
	"k8s.io/client-go/rest"
)

type testArgs struct {
	configParam *config.OperatorApisConfig
	reqUsername string
	reqPassword string
}

func TestNewMiddlewares(t *testing.T) {
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name:    "returns new Middlewares instance when config is provided",
			args:    testArgs{},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				args.configParam = config.NewOperatorApisConfig(&rest.Config{})
			},
		},
		{
			name:    "returns error when config is not provided",
			args:    testArgs{},
			want:    false,
			wantErr: true,
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
			got, err := NewMiddlewares(tt.args.configParam)
			if (err != nil) != tt.wantErr {
				t.Errorf("NewAdminHandler() error got= %v, wantErr %v", err, tt.wantErr)
				return
			}
			if tt.want == true && err != nil && !reflect.DeepEqual(got.appConfig, tt.args.configParam) {
				t.Errorf("NewMiddlewares() got %v, ", got)
			}
		})
	}
}

func Test_middleware_BasicAuthHandler(t *testing.T) {
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
		setup   func(*testArgs)
		cleanup func(*testArgs)
	}{
		{
			name:    "forwards request to next handler on correct credentials",
			args:    testArgs{},
			want:    true,
			wantErr: false,
			setup: func(args *testArgs) {
				args.configParam = config.NewOperatorApisConfig(&rest.Config{})
				args.reqUsername = args.configParam.Username
				args.reqPassword = args.configParam.Password
			},
		},
		{
			name:    "returns unauthorized status on incorrect credentials",
			args:    testArgs{},
			want:    false,
			wantErr: true,
			setup: func(args *testArgs) {
				args.configParam = config.NewOperatorApisConfig(&rest.Config{})
				args.reqUsername = "dummy"
				args.reqPassword = "dummy"
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
			m, _ := NewMiddlewares(tt.args.configParam)
			router := mux.NewRouter()
			router.Use(m.BasicAuthHandler)
			router.HandleFunc("/info", func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, "Dummy Info endpoint")
			})
			req, err := http.NewRequest("GET", "/info", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.SetBasicAuth(tt.args.reqUsername, tt.args.reqPassword)
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			if tt.want {
				if status := rr.Code; status != http.StatusOK {
					t.Errorf("handler returned wrong status code: got %v want %v",
						status, http.StatusOK)
				}
			}
			if tt.wantErr {
				if status := rr.Code; status != http.StatusUnauthorized {
					t.Errorf("handler returned wrong status code: got %v want %v",
						status, http.StatusUnauthorized)
				}
			}
		})
	}
}
