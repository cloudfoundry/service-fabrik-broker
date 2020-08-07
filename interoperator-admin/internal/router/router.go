package router

import (
	"github.com/gorilla/mux"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/handlers"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/middlewares"
)

// GetAdminRouter sets up and returns router for Admin Application
func GetAdminRouter() *mux.Router {
	r := mux.NewRouter()
	r.Use(middlewares.BasicAuthHandler)
	r.HandleFunc("/admin/deployments", handlers.GetDeploymentsSummary).Methods("GET")
	r.HandleFunc("/admin/deployments/{deploymentID}", handlers.GetDeployment).Methods("GET")
	r.HandleFunc("/admin/deployments/{deploymentID}", handlers.UpdateDeployment).Methods("PATCH")
	r.HandleFunc("/admin/deployments", handlers.UpdateDeploymentsInBatch).Methods("PATCH")
	return r
}
