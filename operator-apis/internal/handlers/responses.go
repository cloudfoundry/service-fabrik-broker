package handlers

import "encoding/json"

type deploymentsSummaryResponse struct {
	TotalDeployments       int              `json:"totalDeployments"`
	TotalDeploymentsOnPage int              `json:"totalDeploymentsOnPage"`
	PageSize               int64            `json:"pageSize"`
	NextPageURL            string           `json:"nextPageURL"`
	Deployments            []deploymentInfo `json:"deployments"`
}

type deploymentInfo struct {
	DeploymentID     string            `json:"id"`
	ServiceID        string            `json:"serviceId"`
	PlanID           string            `json:"planId"`
	Context          json.RawMessage   `json:"context,omitempty"`
	ClusterID        string            `json:"clusterId"`
	DeploymentStatus *deploymentStatus `json:"status,omitempty"`
}

type deploymentStatus struct {
	State       string `json:"state"`
	Description string `json:"description"`
}
