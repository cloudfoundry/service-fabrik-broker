package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/config"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/client/clientset/versioned"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/constants"
	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	ctrl "sigs.k8s.io/controller-runtime"
)

var log = ctrl.Log.WithName("handler")

// OperatorApisHandler represents a set of functions to handle Operator APIs
type OperatorApisHandler struct {
	appConfig *config.OperatorApisConfig
}

// NewOperatorApisHandler returns OperatorApisHandler using given configuration
func NewOperatorApisHandler(appConfig *config.OperatorApisConfig) (*OperatorApisHandler, error) {
	if appConfig == nil {
		return nil, errors.New("configuration was not passed while initializing handler")
	}
	return &OperatorApisHandler{
		appConfig: appConfig,
	}, nil
}

/* API Handler Functions */

// GetInfo can return info about app
func (h *OperatorApisHandler) GetInfo(w http.ResponseWriter, r *http.Request) {
	log.V(2).Info("Returning from Info")
	fmt.Fprintf(w, "Interoperator Admin App")
}

// GetDeploymentsSummary returns summary of the existing deployments
func (h *OperatorApisHandler) GetDeploymentsSummary(w http.ResponseWriter, r *http.Request) {
	labelSelector := createLabelSelectorFromQueryParams(r)
	log.Info("labelSelector formed using query params: ", "labelSelector", labelSelector)
	clientset, err := initInteroperatorClientset(h.appConfig.Kubeconfig)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances("")
	listOptions := metav1.ListOptions{
		LabelSelector: labelSelector,
	}
	//Get the total deployments before making pagination requests to server
	completeInstancesList, err := sfserviceinstanceClient.List(listOptions)
	if err != nil {
		log.Error(err, "Error while reading sfserviceinstances from apiserver: ")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	resp := deploymentsSummaryResponse{}
	resp.TotalDeployments = len(completeInstancesList.Items)
	continueToken, limit := extractPaginationInfo(r, h.appConfig)
	log.Info("extracted following information for pagination ", "pageSize", limit)
	if limit != 0 {
		listOptions.Limit = limit
	}
	if continueToken != "" {
		listOptions.Continue = continueToken
	}
	instances, err := sfserviceinstanceClient.List(listOptions)
	if err != nil {
		log.Error(err, "Error while reading sfserviceinstances from apiserver: ")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	log.Info("Number of instances obtained from the cluster: ", "instances", len(instances.Items))
	resp.TotalDeploymentsOnPage = len(instances.Items)
	for _, obj := range instances.Items {
		log.Info("Service with ID was found", "ID", obj.GetName())
		deployment := deploymentInfo{}
		deployment.DeploymentStatus = &deploymentStatus{}
		populateDeploymentInfo(&obj, &deployment)
		resp.Deployments = append(resp.Deployments, deployment)
	}
	if instances.Continue != "" {
		nextURL, err := getNextPageURL(r, limit, instances.Continue)
		if err == nil {
			resp.NextPageURL = nextURL
		}
	}
	resp.PageSize = limit
	respJSON, err := json.Marshal(resp)
	if err != nil {
		log.Error(err, "Error in json marshalling")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if _, err = w.Write(respJSON); err != nil {
		log.Error(err, "could not write response.")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// GetDeployment returns summary of the given deployment
func (h *OperatorApisHandler) GetDeployment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	deploymentID := vars["deploymentID"]
	instanceNamespace := "sf-" + deploymentID
	log.Info("Trying to get summary for : ", "deployment", deploymentID, "namespace", instanceNamespace)
	clientset, err := initInteroperatorClientset(h.appConfig.Kubeconfig)
	if err != nil {
		log.Error(err, "Error while initializing clientset")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances(instanceNamespace)
	instance, err := sfserviceinstanceClient.Get(deploymentID, metav1.GetOptions{})
	if err != nil {
		log.Error(err, "Error while getting service instance from apiserver")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	deployment := deploymentInfo{}
	deployment.DeploymentStatus = &deploymentStatus{}
	populateDeploymentInfo(instance, &deployment)
	respJSON, err := json.Marshal(deployment)
	if err != nil {
		log.Error(err, "Error in json marshalling")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if _, err = w.Write(respJSON); err != nil {
		log.Error(err, "could not write response.")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// UpdateDeployment triggers update of a single deployment
func (h *OperatorApisHandler) UpdateDeployment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	deploymentID := vars["deploymentID"]
	log.Info("Trying to trigger update for: ", "deployment", deploymentID)
	clientset, err := initInteroperatorClientset(h.appConfig.Kubeconfig)
	if err != nil {
		log.Error(err, "Error while initializing clients")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	instanceNamespace := "sf-" + deploymentID
	sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances(instanceNamespace)
	instance, err := sfserviceinstanceClient.Get(deploymentID, metav1.GetOptions{})
	if err != nil {
		log.Error(err, "Error while getting service instance from apiserver")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	instance.SetState("update")
	_, err = sfserviceinstanceClient.Update(instance)
	if err != nil {
		log.Error(err, "Error while updating instance")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	log.Info("Triggered update for: ", "deployment", deploymentID)
	fmt.Fprintf(w, "Update for %s was successfully triggered", deploymentID)
}

// UpdateDeploymentsInBatch triggers update of all deployments in given batch
func (h *OperatorApisHandler) UpdateDeploymentsInBatch(w http.ResponseWriter, r *http.Request) {
	labelSelector := createLabelSelectorFromQueryParams(r)
	log.Info("Using following labelSelector for triggering update: ", "labelSelector", labelSelector)
	clientset, err := initInteroperatorClientset(h.appConfig.Kubeconfig)
	if err != nil {
		log.Error(err, "Error while initializing clients")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances("")
	instances, err := sfserviceinstanceClient.List(metav1.ListOptions{
		LabelSelector: labelSelector,
	})
	if err != nil {
		log.Error(err, "Error while reading sfserviceinstances from apiserver: ")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	log.Info("Number of instances obtained from the apiserver: ", "instances", len(instances.Items))
	go func() {
		successCount := triggerBatchUpdates(instances, clientset)
		log.Info(fmt.Sprintf("Successfully triggered updates for %d deployments", successCount))
	}()
	fmt.Fprintf(w, "Triggering update for %d instances", len(instances.Items))
}

func triggerBatchUpdates(instances *osbv1alpha1.SFServiceInstanceList, clientset *versioned.Clientset) int {
	successCount := 0
	log.Info(fmt.Sprintf("Attempting to trigger the update for %d deployments", len(instances.Items)))
	for _, obj := range instances.Items {
		instanceNamespace := "sf-" + obj.GetName()
		sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances(instanceNamespace)
		obj.SetState("update")
		_, err := sfserviceinstanceClient.Update(&obj)
		if err != nil {
			log.Error(err, "Error while updating deployment", "deploymentID", obj.GetName())
		} else {
			successCount++
			log.Info("Update triggered for deployment: ", "deploymentID", obj.GetName())
		}
		time.Sleep(constants.DelayBetweenBatchUpdates * time.Second)
	}
	return successCount
}
