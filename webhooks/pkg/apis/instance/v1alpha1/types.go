package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// +genclient
// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// Sfevent is a specification for a Sfevent resource
type Sfevent struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   SfeventSpec   `json:"spec"`
	Status SfeventStatus `json:"status"`
}

// SfeventSpec is the spec for a Sfevent resource
type SfeventSpec struct {
	Options SfeventOptions `json:"options,omitempty"`
}

// SfeventStatus is the status for a Sfevent resource
type SfeventStatus struct {
	Error    string `json:"error,omitempty"`
	Response string `json:"response,omitempty"`
	State    string `json:"state,omitempty"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

// SfeventList is a list of Sfevent resources
type SfeventList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata"`

	Items []Sfevent `json:"items"`
}

// ServiceInfo holds the service id and plan id
type ServiceInfo struct {
	// The id mentioned is the SKU name of service
	// like redis, postgresql and not uutd
	ID   string `json:"id"`
	Plan string `json:"plan"`
}

// ConsumerInfo holds the consumer related details
type ConsumerInfo struct {
	Environment string `json:"environment"`
	Region      string `json:"region"`
	Org         string `json:"org"`
	Space       string `json:"space"`
	Instance    string `json:"instance"`
}

// InstancesMeasure holds the measured values
type InstancesMeasure struct {
	ID    string `json:"id"`
	Value int    `json:"value"`
}

// SfeventOptions represents the options field of Sfevent Resource
// models schema here:
// https://wiki.wdf.sap.corp/wiki/display/CPC15N/Usage+Document+Detailed+Schema
type SfeventOptions struct {
	ID                string             `json:"id"`
	Timestamp         string             `json:"timestamp"`
	ServiceInfo       ServiceInfo        `json:"service"`
	ConsumerInfo      ConsumerInfo       `json:"consumer"`
	InstancesMeasures []InstancesMeasure `json:"measures"`
}
