package resources

import (
	"bytes"
	"encoding/json"

	"github.com/golang/glog"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// GenericResource type represents a generic resource
type GenericResource struct {
	Kind              string `json:"kind"`
	metav1.ObjectMeta `json:"metadata,omitempty"`
	Status            GenericStatus `json:"status,omitempty"`
	Spec              GenericSpec   `json:"spec,omitempty"`
}

// SetLastOperation stores the LastOperation as json string
func (crd *GenericResource) SetLastOperation(lo GenericLastOperation) error {
	val, err := json.Marshal(lo)
	crd.Status.LastOperationRaw = string(val)
	return err
}

// GetLastOperation unmarshals the json data into GenericLastOperation
func (crd *GenericResource) GetLastOperation() (GenericLastOperation, error) {
	var lo GenericLastOperation
	// LastOperation could be null during Craete
	if crd.Status.LastOperationRaw != "" {
		loDecoder := json.NewDecoder(bytes.NewReader([]byte(crd.Status.LastOperationRaw)))
		if err := loDecoder.Decode(&lo); err != nil {
			glog.Errorf("Could not unmarshal raw object of lastOperation: %v", err)
			return lo, err
		}
	}
	return lo, nil
}

// GetGenericResource decodes byte array to GenericResource
func GetGenericResource(object []byte) (GenericResource, error) {
	var crd GenericResource
	decoder := json.NewDecoder(bytes.NewReader(object))
	err := decoder.Decode(&crd)
	if err != nil {
		glog.Errorf("Could not unmarshal raw object: %v", err)
	}
	return crd, err
}

// GetAppliedOptions unmarshals the json data into GenericOptions
func (crd *GenericResource) GetAppliedOptions() GenericOptions {
	var op GenericOptions
	// AppliedOptions could be null during Craete
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

// SetAppliedOptions stores the AppliedOptions as json string
func (crd *GenericResource) SetAppliedOptions(ao GenericOptions) error {
	val, err := json.Marshal(ao)
	crd.Status.AppliedOptions = string(val)
	return err
}
