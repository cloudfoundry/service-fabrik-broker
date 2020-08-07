package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/client/clientset/versioned"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/constants"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	ctrl "sigs.k8s.io/controller-runtime"
)

var log = ctrl.Log.WithName("handler")

/* API Handler Functions */

// GetDeploymentsSummary returns summary of the existing deployments
func GetDeploymentsSummary(w http.ResponseWriter, r *http.Request) {
	labelSelector := createLabelSelectorFromQueryParams(r)
	log.Info("labelSelector formed using query params: ", "labelSelector", labelSelector)
	clientset, err := initClientset()
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
func GetDeployment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	deploymentID := vars["deploymentID"]
	isntanceNamespace := "sf-" + deploymentID
	log.Info("Trying to get summary for : ", "deployment", deploymentID, "namespace", isntanceNamespace)
	clientset, err := initClientset()
	if err != nil {
		log.Error(err, "Error while initializing clientset")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances(isntanceNamespace)
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
func UpdateDeployment(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	deploymentID := vars["deploymentID"]
	log.Info("Trying to trigger update for: ", "deployment", deploymentID)
	clientset, err := initClientset()
	if err != nil {
		log.Error(err, "Error while initializing clients")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	isntanceNamespace := "sf-" + deploymentID
	sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances(isntanceNamespace)
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
func UpdateDeploymentsInBatch(w http.ResponseWriter, r *http.Request) {
	labelSelector := createLabelSelectorFromQueryParams(r)
	log.Info("Using following labelSelector for triggering update: ", "labelSelector", labelSelector)
	clientset, err := initClientset()
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

/* Utility Functions */
func initClientset() (*versioned.Clientset, error) {
	config, err := ctrl.GetConfig()
	if err != nil {
		log.Error(err, "Error while reading kubeconfig")
		return nil, err
	}

	clientset, err := versioned.NewForConfig(config)
	if err != nil {
		log.Error(err, "Error while creating clientset")
		return nil, err
	}
	return clientset, nil
}

func populateDeploymentInfo(instance *osbv1alpha1.SFServiceInstance, deployment *deploymentInfo) {
	deployment.DeploymentID = instance.GetName()
	deployment.ServiceID = instance.Spec.ServiceID
	deployment.PlanID = instance.Spec.PlanID
	deployment.ClusterID = instance.Spec.ClusterID
	deployment.DeploymentStatus.State = instance.GetState()
	deployment.DeploymentStatus.Description = instance.Status.Description
	if instanceRawContext, err := instance.Spec.RawContext.MarshalJSON(); err == nil {
		deployment.Context = json.RawMessage(instanceRawContext)
	} else {
		log.Error(err, "Error in marshalling instance context for instance ", "ID", instance.GetName())
	}
}

func createLabelSelectorFromQueryParams(r *http.Request) string {
	var labelSelectors []string
	for queryKey, label := range constants.SupportedQueryKeysToLabels {
		queryParam := r.URL.Query().Get(queryKey)
		if queryParam != "" {
			labelSelectors = append(labelSelectors, label+"="+queryParam)
		}
	}
	return strings.Join(labelSelectors, ",")
}

func triggerBatchUpdates(instances *osbv1alpha1.SFServiceInstanceList, clientset *versioned.Clientset) int {
	successCount := 0
	log.Info(fmt.Sprintf("Attempting to trigger the update for %d deployments", len(instances.Items)))
	for _, obj := range instances.Items {
		isntanceNamespace := "sf-" + obj.GetName()
		sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances(isntanceNamespace)
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
