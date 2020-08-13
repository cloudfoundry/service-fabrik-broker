package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/constants"
	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/client/clientset/versioned"
	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
	ctrl "sigs.k8s.io/controller-runtime"
)

var log = ctrl.Log.WithName("handler")

// AdminHandler represents a set of handlers to handle admin APIs
type AdminHandler struct {
	kubeconfig *rest.Config
}

// NewAdminHandler returns AdminHandler using given kubeconfig
func NewAdminHandler(cfg *rest.Config) (*AdminHandler, error) {
	if cfg == nil {
		return nil, errors.New("kubeconfig was not provided")
	}
	return &AdminHandler{
		kubeconfig: cfg,
	}, nil
}

/* API Handler Functions */

// GetInfo can return info about app
func (h *AdminHandler) GetInfo(w http.ResponseWriter, r *http.Request) {
	log.Info("Returning from Info")
	fmt.Fprintf(w, "Interoperator Admin App")
}

// GetDeploymentsSummary returns summary of the existing deployments
func (h *AdminHandler) GetDeploymentsSummary(w http.ResponseWriter, r *http.Request) {
	labelSelector := createLabelSelectorFromQueryParams(r)
	log.Info("labelSelector formed using query params: ", "labelSelector", labelSelector)
	clientset, err := initInteroperatorClientset(h.kubeconfig)
	if err != nil {
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
	log.Info("Number of instances obtained from the cluster: ", "instances", len(instances.Items))
	resp := deploymentsSummaryResponse{}
	resp.TotalDeployments = len(instances.Items)
	for _, obj := range instances.Items {
		log.Info("Service with ID was found", "ID", obj.GetName())
		deployment := deploymentInfo{}
		deployment.DeploymentStatus = &deploymentStatus{}
		populateDeploymentInfo(&obj, &deployment)
		resp.Deployments = append(resp.Deployments, deployment)
	}

	respJSON, err := json.Marshal(resp)
	if err != nil {
		log.Error(err, "Error in json marshalling")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err = w.Write(respJSON); err != nil {
		log.Error(err, "could not write response.")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// GetDeployment returns summary of the given deployment
func (h *AdminHandler) GetDeployment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	deploymentID := vars["deploymentID"]
	instanceNamespace := "sf-" + deploymentID
	log.Info("Trying to get summary for : ", "deployment", deploymentID, "namespace", instanceNamespace)
	clientset, err := initInteroperatorClientset(h.kubeconfig)
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
	if _, err = w.Write(respJSON); err != nil {
		log.Error(err, "could not write response.")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

// UpdateDeployment triggers update of a single deployment
func (h *AdminHandler) UpdateDeployment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	deploymentID := vars["deploymentID"]
	log.Info("Trying to trigger update for: ", "deployment", deploymentID)
	clientset, err := initInteroperatorClientset(h.kubeconfig)
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
func (h *AdminHandler) UpdateDeploymentsInBatch(w http.ResponseWriter, r *http.Request) {
	labelSelector := createLabelSelectorFromQueryParams(r)
	log.Info("Using following labelSelector for triggering update: ", "labelSelector", labelSelector)
	clientset, err := initInteroperatorClientset(h.kubeconfig)
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
