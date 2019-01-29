package resources

// ContextOptions represents the contex information in GenericOptions
type ContextOptions struct {
	Platform         string `json:"platform"`
	OrganizationGUID string `json:"organization_guid"`
	SpaceGUID        string `json:"space_guid"`
}

// GenericOptions represents the option information in Spec
type GenericOptions struct {
	ServiceID string         `json:"service_id"`
	PlanID    string         `json:"plan_id"`
	Context   ContextOptions `json:"context"`
}

// GenericLastOperation represents the last option information in Status
type GenericLastOperation struct {
	Type  string `json:"type"`
	State string `json:"state"`
}

// GenericStatus type represents the status in GenericResource
type GenericStatus struct {
	AppliedOptions   string `json:"appliedOptions"`
	State            string `json:"state,omitempty"`
	LastOperationRaw string `json:"lastOperation,omitempty"`
}
