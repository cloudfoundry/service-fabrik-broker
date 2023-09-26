package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/config"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/client/clientset/versioned"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
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
	ctx := context.Background()
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
	completeInstancesList, err := sfserviceinstanceClient.List(ctx, listOptions)
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
	instances, err := sfserviceinstanceClient.List(ctx, listOptions)
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
	ctx := context.Background()
	vars := mux.Vars(r)
	instanceID := vars["deploymentID"]
	deploymentID := GetKubernetesName(instanceID)
	instanceNamespace := "sf-" + deploymentID
	log.Info("Trying to get summary for : ", "instanceID", instanceID, "deployment", deploymentID, "namespace", instanceNamespace)
	clientset, err := initInteroperatorClientset(h.appConfig.Kubeconfig)
	if err != nil {
		log.Error(err, "Error while initializing clientset")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances(instanceNamespace)
	instance, err := sfserviceinstanceClient.Get(ctx, deploymentID, metav1.GetOptions{})
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
	ctx := context.Background()
	vars := mux.Vars(r)
	instanceID := vars["deploymentID"]
	deploymentID := GetKubernetesName(instanceID)
	log.Info("Trying to trigger update for: ", "instanceID", instanceID, "deployment", deploymentID)
	clientset, err := initInteroperatorClientset(h.appConfig.Kubeconfig)
	if err != nil {
		log.Error(err, "Error while initializing clients")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	instanceNamespace := "sf-" + deploymentID
	sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances(instanceNamespace)
	instance, err := sfserviceinstanceClient.Get(ctx, deploymentID, metav1.GetOptions{})
	if err != nil {
		log.Error(err, "Error while getting service instance from apiserver")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	instance.SetState("update")
	_, err = sfserviceinstanceClient.Update(ctx, instance, metav1.UpdateOptions{})
	if err != nil {
		log.Error(err, "Error while updating instance")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	log.Info("Triggered update for: ", "instanceID", instanceID, "deployment", deploymentID)
	fmt.Fprintf(w, "Update for %s was successfully triggered", deploymentID)
}

// UpdateDeploymentsInBatch triggers update of all deployments in given batch
func (h *OperatorApisHandler) UpdateDeploymentsInBatch(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	labelSelector := createLabelSelectorFromQueryParams(r)
	log.Info("Using following labelSelector for triggering update: ", "labelSelector", labelSelector)
	clientset, err := initInteroperatorClientset(h.appConfig.Kubeconfig)
	if err != nil {
		log.Error(err, "Error while initializing clients")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances("")
	instances, err := sfserviceinstanceClient.List(ctx, metav1.ListOptions{
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

func (h *OperatorApisHandler) ForceBindingCleanup(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	vars := mux.Vars(r)
	instanceID := vars["instanceID"]
	bindingID := vars["bindingID"]
	clientset, err := initInteroperatorClientset(h.appConfig.Kubeconfig)
	if err != nil {
		log.Error(err, "Error while initializing clients")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Info("Triggered cleanup for: ", "bindingID", bindingID, "instanceID", instanceID)

	namespace := "sf-" + instanceID
	sfservicebindingClient := clientset.OsbV1alpha1().SFServiceBindings(namespace)
	binding, err := sfservicebindingClient.Get(ctx, bindingID, metav1.GetOptions{})
	if err != nil {
		log.Error(err, "Error while getting service binding from apiserver")
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	labels := binding.GetLabels()
	lastOperation, ok := labels[constants.LastOperationKey]
	if !ok {
		log.Error(err, "Error while lastOperation of binding")
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}

	if lastOperation != "delete" {
		log.Info("Got binding lastOperation state is delete")

		err = sfservicebindingClient.Delete(ctx, bindingID, metav1.DeleteOptions{})
		if err != nil {
			log.Error(err, "Error while deleting instance")
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		binding, err := sfservicebindingClient.Get(ctx, bindingID, metav1.GetOptions{})
		if err != nil {
			log.Error(err, "Error while getting service binding from apiserver")
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		binding.SetState("delete")
		_, err = sfservicebindingClient.Update(ctx, binding, metav1.UpdateOptions{})
		if err != nil {
			log.Error(err, "Error while updating instance")
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Info("UPDATE: set state to delete triggered for the binding")

		if utils.ContainsString(binding.GetFinalizers(), constants.BrokerFinializer) {
			log.Info("Removing broker finalizers", "bindingID", bindingID, "instanceID", instanceID)
			binding, err := sfservicebindingClient.Get(ctx, bindingID, metav1.GetOptions{})
			if err != nil {
				log.Error(err, "Error while getting service binding from apiserver")
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			binding.SetFinalizers(utils.RemoveString(binding.GetFinalizers(), constants.BrokerFinializer))
			_, err = sfservicebindingClient.Update(ctx, binding, metav1.UpdateOptions{})
			if err != nil {
				log.Error(err, "Error while updating instance")
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			log.Info("Removed broker finalizers", "bindingID", bindingID, "instanceID", instanceID)
		}
	} else {
		log.Info("Binding is in delete state", "bindingID", bindingID, "instanceID", instanceID)
		binding.SetFinalizers([]string{})
		_, err = sfservicebindingClient.Update(ctx, binding, metav1.UpdateOptions{})
		if err != nil {
			log.Error(err, "Error while updating instance")
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		log.Info("Removed all finalizers", "bindingID", bindingID, "instanceID", instanceID)
	}

	fmt.Fprintf(w, "Deleted binding %s  deleted successfully", bindingID)
	w.WriteHeader(http.StatusOK)
}

func triggerBatchUpdates(instances *osbv1alpha1.SFServiceInstanceList, clientset *versioned.Clientset) int {
	ctx := context.Background()
	successCount := 0
	log.Info(fmt.Sprintf("Attempting to trigger the update for %d deployments", len(instances.Items)))
	for _, obj := range instances.Items {
		instanceNamespace := "sf-" + obj.GetName()
		sfserviceinstanceClient := clientset.OsbV1alpha1().SFServiceInstances(instanceNamespace)
		obj.SetState("update")
		_, err := sfserviceinstanceClient.Update(ctx, &obj, metav1.UpdateOptions{})
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
