package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator-admin/internal/constants"
	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/client/clientset/versioned"
	"k8s.io/client-go/rest"
)

// InitInteroperatorClientset returns a versioned clientset for interoperator
func initInteroperatorClientset(kubeconfig *rest.Config) (*versioned.Clientset, error) {
	clientset, err := versioned.NewForConfig(kubeconfig)
	if err != nil {
		log.Error(err, "Error while creating clientset")
		return nil, err
	}
	return clientset, nil
}

// CreateLabelSelectorFromQueryParams returns a labelsector string based on the req params
// and SupportedQueryKeysToLabels map
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

func populateDeploymentInfo(instance *osbv1alpha1.SFServiceInstance, deployment *deploymentInfo) {
	deployment.DeploymentID = instance.GetName()
	deployment.ServiceID = instance.Spec.ServiceID
	deployment.PlanID = instance.Spec.PlanID
	deployment.ClusterID = instance.Spec.ClusterID
	deployment.DeploymentStatus.State = instance.GetState()
	deployment.DeploymentStatus.Description = instance.Status.Description
	if instance.Spec.RawContext != nil {
		if instanceRawContext, err := instance.Spec.RawContext.MarshalJSON(); err == nil {
			deployment.Context = json.RawMessage(instanceRawContext)
		} else {
			log.Error(err, "Error in marshalling instance context for instance ", "ID", instance.GetName())
		}
	}
}
