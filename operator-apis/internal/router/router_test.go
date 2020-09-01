package router

import (
	"sort"
	"strings"
	"testing"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/config"
	"github.com/gorilla/mux"
	"k8s.io/client-go/rest"
)

type routeInfo struct {
	path   string
	method string
}

type testArgs struct {
	configParam    *config.OperatorApisConfig
	expectedRoutes []routeInfo
}

func TestGetOperatorApisRouter(t *testing.T) {
	tests := []struct {
		name    string
		args    testArgs
		want    bool
		wantErr bool
	}{
		{
			name: "returns new router for Operator APIs",
			args: testArgs{
				configParam: &config.OperatorApisConfig{
					Kubeconfig: &rest.Config{},
					Username:   "admin",
					Password:   "admin",
				},
				expectedRoutes: []routeInfo{
					routeInfo{
						path:   "/",
						method: "GET",
					},
					routeInfo{
						path:   "/operator", //For subrouter
						method: "",
					},
					routeInfo{
						path:   "/operator/deployments",
						method: "GET",
					},
					routeInfo{
						path:   "/operator/deployments/{deploymentID}",
						method: "GET",
					},
					routeInfo{
						path:   "/operator/deployments",
						method: "PATCH",
					},
					routeInfo{
						path:   "/operator/deployments/{deploymentID}",
						method: "PATCH",
					},
				},
			},
			want:    true,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router, _ := GetOperatorApisRouter(tt.args.configParam)
			if tt.want {
				foundRoutes := []routeInfo{}
				err := router.Walk(func(route *mux.Route, router *mux.Router, ancestors []*mux.Route) error {
					pathTemplate, err := route.GetPathTemplate()
					if err != nil {
						t.Logf("Got error while finding path for route, error %v", err)
					}
					methods, err := route.GetMethods()
					if err != nil {
						t.Logf("Got error while finding method for route, error %v", err)
					}
					foundRoutes = append(foundRoutes, routeInfo{
						path:   pathTemplate,
						method: strings.Join(methods, ","),
					})
					return nil
				})
				if err != nil {
					t.Errorf("Got error while walking through router %v", err)
				}
				if !validateRoutes(foundRoutes, tt.args.expectedRoutes) {
					t.Errorf("Routes validation failed. Got %v Expected %v", foundRoutes, tt.args.expectedRoutes)
				}
			}
		})
	}
}

func validateRoutes(found []routeInfo, expected []routeInfo) bool {
	if len(found) != len(expected) {
		return false
	}
	sort.Slice(found[:], func(i, j int) bool {
		return found[i].path < found[j].path
	})
	sort.Slice(expected[:], func(i, j int) bool {
		return expected[i].path < expected[j].path
	})
	for i := 0; i < len(found); i++ {
		if found[i].path != expected[i].path || found[i].method != expected[i].method {
			return false
		}
	}
	return true
}
