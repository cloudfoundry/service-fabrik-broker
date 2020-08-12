package router

import (
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/handlers"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/middlewares"
	"github.com/gorilla/mux"
	"k8s.io/client-go/rest"
)

// GetAdminRouter sets up and returns router for Admin Application
func GetAdminRouter(kubeconfig *rest.Config, adminConfig *config.InteroperatorAdminConfig) *mux.Router {
	h, err := handlers.NewAdminHandler(kubeconfig)
	if err != nil {
		panic("Could not initialize admin handler")
	}
	m, err := middlewares.NewMiddlewares(adminConfig)
	if err != nil {
		panic("Could not initialize admin handler")
	}
	r := mux.NewRouter()
	r.Use(m.BasicAuthHandler)
	r.HandleFunc("/admin/deployments", h.GetDeploymentsSummary).Methods("GET")
	r.HandleFunc("/admin/deployments/{deploymentID}", h.GetDeployment).Methods("GET")
	r.HandleFunc("/admin/deployments/{deploymentID}", h.UpdateDeployment).Methods("PATCH")
	r.HandleFunc("/admin/deployments", h.UpdateDeploymentsInBatch).Methods("PATCH")
	return r
}
