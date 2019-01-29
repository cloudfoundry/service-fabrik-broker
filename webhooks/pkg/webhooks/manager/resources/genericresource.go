package resources

import (
	"bytes"
	"encoding/json"

	"github.com/golang/glog"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

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

// GenericSpec represents the Spec in GenericResource
type GenericSpec struct {
	Options string `json:"options,omitempty"`
}

func (g *GenericSpec) GetOptions() (GenericOptions, error) {
	var opts GenericOptions
	decoder := json.NewDecoder(bytes.NewReader([]byte(g.Options)))
	err := decoder.Decode(&opts)
	if err != nil {
		glog.Errorf("Could not unmarshal raw object: %v", err)
	}
	return opts, err
}

func (g *GenericSpec) SetOptions(options GenericOptions) error {
    val, err := json.Marshal(options)
    g.Options = string(val)
    return err
}

// GenericStatus type represents the status in GenericResource
type GenericStatus struct {
	AppliedOptions   string `json:"appliedOptions"`
	State            string `json:"state,omitempty"`
	LastOperationRaw string `json:"lastOperation,omitempty"`
	LastOperationObj    GenericLastOperation
	AppliedOptionsObj   GenericOptions
}

// GenericResource type represents a generic resource
type GenericResource struct {
	Kind              string `json:"kind"`
	metav1.ObjectMeta `json:"metadata,omitempty"`
	Status            GenericStatus `json:"status,omitempty"`
	Spec              GenericSpec   `json:"spec,omitempty"`
}

func GetGenericResource(object []byte) (GenericResource, error) {
	var crd GenericResource
	decoder := json.NewDecoder(bytes.NewReader(object))
	err := decoder.Decode(&crd)
	if err != nil {
		glog.Errorf("Could not unmarshal raw object: %v", err)
	}
	return crd, err
}

func GetLastOperation(crd GenericResource) GenericLastOperation {
	var lo GenericLastOperation
	// LastOperation could be null during Craete
	if crd.Status.LastOperationRaw != "" {
		loDecoder := json.NewDecoder(bytes.NewReader([]byte(crd.Status.LastOperationRaw)))
		if err := loDecoder.Decode(&lo); err != nil {
			glog.Errorf("Could not unmarshal raw object of lastOperation: %v", err)
		}
	} else {
		lo = GenericLastOperation{}
	}
	return lo
}

func GetOptions(crd GenericResource) GenericOptions {
	var op GenericOptions
	opDecoder := json.NewDecoder(bytes.NewReader([]byte(crd.Spec.Options)))
	if err := opDecoder.Decode(&op); err != nil {
		glog.Errorf("Could not unmarshal raw object of Options: %v", err)
	}
	return op
}

func GetAppliedOptions(crd GenericResource) GenericOptions {
	var op GenericOptions
	// LastOperation could be null during Craete
	if crd.Status.AppliedOptions != "" {
		opDecoder := json.NewDecoder(bytes.NewReader([]byte(crd.Status.AppliedOptions)))
		if err := opDecoder.Decode(&op); err != nil {
			glog.Errorf("Could not unmarshal raw object of AppliedOptions: %v", err)
		}
	} else {
		op = GenericOptions{}
	}
	return op
}
