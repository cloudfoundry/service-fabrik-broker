/*
Copyright 2018 The Service Fabrik Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package v1alpha1

import "fmt"

// Source is the details for identifying each resource
// sources.yaml file is unmarshalled to a map[string]Source
type Source struct {
	APIVersion string `yaml:"apiVersion" json:"apiVersion"`
	Kind       string `yaml:"kind" json:"kind"`
	Name       string `yaml:"name" json:"name"`
	Namespace  string `yaml:"namespace" json:"namespace"`
}

func (r Source) String() string {
	return fmt.Sprintf("%s/%s (%s %s)", r.Namespace, r.Name, r.Kind, r.APIVersion)
}

// GetKind returns the Kind of the resource
func (r Source) GetKind() string {
	return r.Kind
}

// GetAPIVersion returns the APIVersion of the resource
func (r Source) GetAPIVersion() string {
	return r.APIVersion
}

// GetName returns the Name of the resource
func (r Source) GetName() string {
	return r.Name
}

// GetNamespace returns the Namespace of the resource
func (r Source) GetNamespace() string {
	return r.Namespace
}

// APIVersionKind unambiguously identifies a kind.
type APIVersionKind struct {
	APIVersion string `yaml:"apiVersion" json:"apiVersion"`
	Kind       string `yaml:"kind" json:"kind"`
}

func (r APIVersionKind) String() string {
	return fmt.Sprintf("%s %s", r.Kind, r.APIVersion)
}

// GetKind returns the Kind of the resource
func (r APIVersionKind) GetKind() string {
	return r.Kind
}

// GetAPIVersion returns the APIVersion of the resource
func (r APIVersionKind) GetAPIVersion() string {
	return r.APIVersion
}
