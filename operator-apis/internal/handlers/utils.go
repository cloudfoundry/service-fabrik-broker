package handlers

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
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

// IsDNS1123Subdomain tests for a string that conforms to the definition of a
// subdomain in DNS (RFC 1123).
func IsDNS1123Subdomain(value string) bool {
	const dns1123LabelFmt string = "[a-z0-9]([-a-z0-9]*[a-z0-9])?"
	const dns1123SubdomainFmt string = dns1123LabelFmt + "(\\." + dns1123LabelFmt + ")*"

	// DNS1123SubdomainMaxLength is a subdomain's max length in DNS (RFC 1123)
	const DNS1123SubdomainMaxLength int = 253
	var dns1123SubdomainRegexp = regexp.MustCompile("^" + dns1123SubdomainFmt + "$")

	if len(value) <= 0 || len(value) > DNS1123SubdomainMaxLength {
		return false
	}
	return dns1123SubdomainRegexp.MatchString(value)
}

// Sha224Sum returns the SHA224 checksum of the input string
// as a hex decoded string, with lower-case letters for a-f
func Sha224Sum(value string) string {
	return fmt.Sprintf("%x", sha256.Sum224([]byte(value)))
}

// GetKubernetesName tests for the id to be a valid kubernetes name
// and return the id if it already valid. If the input is not a valid
// kubernetes name, it returns the SHA224 sum of the input
func GetKubernetesName(id string) string {
	if IsDNS1123Subdomain(id) {
		return id
	}
	return Sha224Sum(id)
}
