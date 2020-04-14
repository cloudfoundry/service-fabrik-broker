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

import (
	"reflect"
	"testing"
)

func TestSource_String(t *testing.T) {
	type fields struct {
		APIVersion string
		Kind       string
		Name       string
		Namespace  string
	}
	tests := []struct {
		name   string
		fields fields
		want   string
	}{
		{
			name: "return concatenated string",
			fields: fields{
				APIVersion: "APIVersion",
				Kind:       "Kind",
				Name:       "Name",
				Namespace:  "Namespace",
			},
			want: "Namespace/Name (Kind APIVersion)",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := Source{
				APIVersion: tt.fields.APIVersion,
				Kind:       tt.fields.Kind,
				Name:       tt.fields.Name,
				Namespace:  tt.fields.Namespace,
			}
			if got := r.String(); got != tt.want {
				t.Errorf("Source.String() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSource_GetKind(t *testing.T) {
	type fields struct {
		APIVersion string
		Kind       string
		Name       string
		Namespace  string
	}
	tests := []struct {
		name   string
		fields fields
		want   string
	}{
		{
			name: "return kind",
			fields: fields{
				APIVersion: "APIVersion",
				Kind:       "Kind",
				Name:       "Name",
				Namespace:  "Namespace",
			},
			want: "Kind",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := Source{
				APIVersion: tt.fields.APIVersion,
				Kind:       tt.fields.Kind,
				Name:       tt.fields.Name,
				Namespace:  tt.fields.Namespace,
			}
			if got := r.GetKind(); got != tt.want {
				t.Errorf("Source.GetKind() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSource_GetAPIVersion(t *testing.T) {
	type fields struct {
		APIVersion string
		Kind       string
		Name       string
		Namespace  string
	}
	tests := []struct {
		name   string
		fields fields
		want   string
	}{
		{
			name: "return APIVersion",
			fields: fields{
				APIVersion: "APIVersion",
				Kind:       "Kind",
				Name:       "Name",
				Namespace:  "Namespace",
			},
			want: "APIVersion",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := Source{
				APIVersion: tt.fields.APIVersion,
				Kind:       tt.fields.Kind,
				Name:       tt.fields.Name,
				Namespace:  tt.fields.Namespace,
			}
			if got := r.GetAPIVersion(); got != tt.want {
				t.Errorf("Source.GetAPIVersion() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSource_GetName(t *testing.T) {
	type fields struct {
		APIVersion string
		Kind       string
		Name       string
		Namespace  string
	}
	tests := []struct {
		name   string
		fields fields
		want   string
	}{
		{
			name: "return Name",
			fields: fields{
				APIVersion: "APIVersion",
				Kind:       "Kind",
				Name:       "Name",
				Namespace:  "Namespace",
			},
			want: "Name",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := Source{
				APIVersion: tt.fields.APIVersion,
				Kind:       tt.fields.Kind,
				Name:       tt.fields.Name,
				Namespace:  tt.fields.Namespace,
			}
			if got := r.GetName(); got != tt.want {
				t.Errorf("Source.GetName() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSource_GetNamespace(t *testing.T) {
	type fields struct {
		APIVersion string
		Kind       string
		Name       string
		Namespace  string
	}
	tests := []struct {
		name   string
		fields fields
		want   string
	}{
		{
			name: "return Namespace",
			fields: fields{
				APIVersion: "APIVersion",
				Kind:       "Kind",
				Name:       "Name",
				Namespace:  "Namespace",
			},
			want: "Namespace",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := Source{
				APIVersion: tt.fields.APIVersion,
				Kind:       tt.fields.Kind,
				Name:       tt.fields.Name,
				Namespace:  tt.fields.Namespace,
			}
			if got := r.GetNamespace(); got != tt.want {
				t.Errorf("Source.GetNamespace() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSource_DeepCopy(t *testing.T) {
	type fields struct {
		APIVersion string
		Kind       string
		Name       string
		Namespace  string
	}
	tests := []struct {
		name   string
		fields fields
		want   *Source
	}{
		{
			name: "return copy",
			fields: fields{
				APIVersion: "APIVersion",
				Kind:       "Kind",
				Name:       "Name",
				Namespace:  "Namespace",
			},
			want: &Source{
				APIVersion: "APIVersion",
				Kind:       "Kind",
				Name:       "Name",
				Namespace:  "Namespace",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := &Source{
				APIVersion: tt.fields.APIVersion,
				Kind:       tt.fields.Kind,
				Name:       tt.fields.Name,
				Namespace:  tt.fields.Namespace,
			}
			if got := in.DeepCopy(); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("Source.DeepCopy() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAPIVersionKind_String(t *testing.T) {
	type fields struct {
		APIVersion string
		Kind       string
	}
	tests := []struct {
		name   string
		fields fields
		want   string
	}{
		{
			name: "return concatenated string",
			fields: fields{
				APIVersion: "APIVersion",
				Kind:       "Kind",
			},
			want: "Kind APIVersion",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := APIVersionKind{
				APIVersion: tt.fields.APIVersion,
				Kind:       tt.fields.Kind,
			}
			if got := r.String(); got != tt.want {
				t.Errorf("APIVersionKind.String() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAPIVersionKind_GetKind(t *testing.T) {
	type fields struct {
		APIVersion string
		Kind       string
	}
	tests := []struct {
		name   string
		fields fields
		want   string
	}{
		{
			name: "return Kind",
			fields: fields{
				APIVersion: "APIVersion",
				Kind:       "Kind",
			},
			want: "Kind",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := APIVersionKind{
				APIVersion: tt.fields.APIVersion,
				Kind:       tt.fields.Kind,
			}
			if got := r.GetKind(); got != tt.want {
				t.Errorf("APIVersionKind.GetKind() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAPIVersionKind_GetAPIVersion(t *testing.T) {
	type fields struct {
		APIVersion string
		Kind       string
	}
	tests := []struct {
		name   string
		fields fields
		want   string
	}{
		{
			name: "return APIVersion",
			fields: fields{
				APIVersion: "APIVersion",
				Kind:       "Kind",
			},
			want: "APIVersion",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := APIVersionKind{
				APIVersion: tt.fields.APIVersion,
				Kind:       tt.fields.Kind,
			}
			if got := r.GetAPIVersion(); got != tt.want {
				t.Errorf("APIVersionKind.GetAPIVersion() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestAPIVersionKind_DeepCopy(t *testing.T) {
	type fields struct {
		APIVersion string
		Kind       string
	}
	tests := []struct {
		name   string
		fields fields
		want   *APIVersionKind
	}{
		{
			name: "return copy",
			fields: fields{
				APIVersion: "APIVersion",
				Kind:       "Kind",
			},
			want: &APIVersionKind{
				APIVersion: "APIVersion",
				Kind:       "Kind",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := &APIVersionKind{
				APIVersion: tt.fields.APIVersion,
				Kind:       tt.fields.Kind,
			}
			if got := in.DeepCopy(); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("APIVersionKind.DeepCopy() = %v, want %v", got, tt.want)
			}
		})
	}
}
