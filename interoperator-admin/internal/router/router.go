package router

import (
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/handlers"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/middlewares"
	"github.com/gorilla/mux"
	"k8s.io/client-go/rest"
	ctrl "sigs.k8s.io/controller-runtime"
)

var log = ctrl.Log.WithName("router")

// GetAdminRouter sets up and returns router for Admin Application
func GetAdminRouter(kubeconfig *rest.Config, adminConfig *config.InteroperatorAdminConfig) (*mux.Router, error) {
	h, err := handlers.NewAdminHandler(kubeconfig)
	if err != nil {
		return nil, err
	}
	m, err := middlewares.NewMiddlewares(adminConfig)
	if err != nil {
		return nil, err
	}
	r := mux.NewRouter()
	r.HandleFunc("/", h.GetInfo).Methods("GET")
	adminRouter := r.PathPrefix("/admin").Subrouter()
	adminRouter.Use(m.BasicAuthHandler)
	adminRouter.HandleFunc("/deployments", h.GetDeploymentsSummary).Methods("GET")
	adminRouter.HandleFunc("/deployments/{deploymentID}", h.GetDeployment).Methods("GET")
	adminRouter.HandleFunc("/deployments/{deploymentID}", h.UpdateDeployment).Methods("PATCH")
	adminRouter.HandleFunc("/deployments", h.UpdateDeploymentsInBatch).Methods("PATCH")
	return r, nil
}
