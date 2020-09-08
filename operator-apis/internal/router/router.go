package router

import (
	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/handlers"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/middlewares"
	"github.com/gorilla/mux"
	ctrl "sigs.k8s.io/controller-runtime"
)

var log = ctrl.Log.WithName("router")

// GetOperatorApisRouter sets up and returns router for Admin Application
func GetOperatorApisRouter(appConfig *config.OperatorApisConfig) (*mux.Router, error) {
	h, err := handlers.NewOperatorApisHandler(appConfig)
	if err != nil {
		return nil, err
	}
	m, err := middlewares.NewMiddlewares(appConfig)
	if err != nil {
		return nil, err
	}
	r := mux.NewRouter()
	r.HandleFunc("/", h.GetInfo).Methods("GET")
	operatorApisRouter := r.PathPrefix("/operator").Subrouter()
	operatorApisRouter.Use(m.BasicAuthHandler)
	operatorApisRouter.HandleFunc("/deployments", h.GetDeploymentsSummary).Methods("GET")
	operatorApisRouter.HandleFunc("/deployments/{deploymentID}", h.GetDeployment).Methods("GET")
	operatorApisRouter.HandleFunc("/deployments/{deploymentID}", h.UpdateDeployment).Methods("PATCH")
	operatorApisRouter.HandleFunc("/deployments", h.UpdateDeploymentsInBatch).Methods("PATCH")
	return r, nil
}
