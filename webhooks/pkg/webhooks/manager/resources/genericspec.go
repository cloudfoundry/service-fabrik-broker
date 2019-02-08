package resources

import (
	"bytes"
	"encoding/json"

	"github.com/golang/glog"
)

// GenericSpec represents the Spec in GenericResource
type GenericSpec struct {
	Options string `json:"options,omitempty"`
}

// GetOptions unmarshals the json data into GenericOptions
func (g *GenericSpec) GetOptions() (GenericOptions, error) {
	var opts GenericOptions
	decoder := json.NewDecoder(bytes.NewReader([]byte(g.Options)))
	err := decoder.Decode(&opts)
	if err != nil {
		glog.Errorf("Could not unmarshal raw object: %v", err)
	}
	return opts, err
}

// SetOptions stores the options as json string
func (g *GenericSpec) SetOptions(options GenericOptions) error {
	val, err := json.Marshal(options)
	g.Options = string(val)
	return err
}
