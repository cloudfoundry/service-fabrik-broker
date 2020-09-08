package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/operator-apis/internal/config"

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

func extractPaginationInfo(r *http.Request, appConfig *config.OperatorApisConfig) (string, int64) {
	var limit int64
	var continueToken string
	var err error
	limitParam := r.URL.Query().Get("pageSize")
	limit, err = strconv.ParseInt(limitParam, 10, 64)
	if err != nil {
		log.Error(err, "")
		limit = 0
	}
	if limit < 0 {
		limit = 0
	}
	continueToken = r.URL.Query().Get("nextPageToken")
	return continueToken, limit
}

func getNextPageURL(r *http.Request, limit int64, continueToken string) (string, error) {
	newURL, err := url.Parse(r.URL.String())
	if err != nil {
		return "", err
	}
	q := newURL.Query()
	q.Set("pageSize", strconv.FormatInt(limit, 10))
	q.Set("nextPageToken", continueToken)
	newURL.RawQuery = q.Encode()
	return newURL.String(), nil
}
