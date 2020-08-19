package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/client/clientset/versioned"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/constants"
	"k8s.io/client-go/rest"
)

func initInteroperatorClientset(kubeconfig *rest.Config) (*versioned.Clientset, error) {
	clientset, err := versioned.NewForConfig(kubeconfig)
	if err != nil {
		log.Error(err, "Error while creating clientset")
		return nil, err
	}
	return clientset, nil
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

/*
func getPageBoundaries(totalItems int, pageNumber int, pageSize int) (int, int) {
	startIndex := (pageNumber - 1) * pageSize
	endIndex := startIndex + pageSize - 1
	if endIndex >= totalItems {
		endIndex = totalItems - 1
	}
	return startIndex, endIndex
}

func extractPaginationInfo(r *http.Request, config *config.Opera) (int, int) {
	var pageNumber, pageSize int
	pageNumberParam := r.URL.Query().Get("page")
	if pageNumberParam == "" {
		pageNumber = 0
	} else {
		pageNumber, err := strconv.Atoi(pageNumberParam)
		if err != nil {
			log.Error(err, "Invalid page query parameter")
			pageNumber = 0
		}
	}
	pageSizeParam := r.URL.Query().Get("pageSize")
	if pageSizeParam == "" {
		pageSize =
	} else {
		pageNumber, err := strconv.Atoi(pageNumberParam)
		if err != nil {
			log.Error(err, "Invalid page query parameter")
			pageNumber = 0
		}
	}
}

*/
