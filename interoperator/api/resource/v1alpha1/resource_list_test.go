/*
Copyright 2019 The Service Fabrik Authors.

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
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

func TestResourceListEqual(t *testing.T) {
	type args struct {
		x corev1.ResourceList
		y corev1.ResourceList
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "check equal",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
			},
			want: true,
		},
		{
			name: "check unequal",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(2048, resource.BinarySI),
				},
			},
			want: false,
		},
		{
			name: "check unequal on null y",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
				y: nil,
			},
			want: false,
		},
		{
			name: "check unequal on null r",
			args: args{
				x: nil,
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(2048, resource.BinarySI),
				},
			},
			want: false,
		},
		{
			name: "check equal on both null",
			args: args{
				x: nil,
				y: nil,
			},
			want: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResourceListEqual(tt.args.x, tt.args.y); got != tt.want {
				t.Errorf("ResourceListEqual() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestResourceListLess(t *testing.T) {
	type args struct {
		x corev1.ResourceList
		y corev1.ResourceList
	}
	tests := []struct {
		name string
		args args
		want bool
	}{
		{
			name: "less if y is bigger in both cpu and memory",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(2, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(2048, resource.BinarySI),
				},
			},
			want: true,
		},
		{
			name: "not less if y is bigger only on memory",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(2048, resource.BinarySI),
				},
			},
			want: false,
		},
		{
			name: "not less if y is bigger only on cpu",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(2, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
			},
			want: false,
		},
		{
			name: "not less if y is nil",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
				y: nil,
			},
			want: false,
		},
		{
			name: "less if r is nil and y is not nil",
			args: args{
				x: nil,
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(2, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(2048, resource.BinarySI),
				},
			},
			want: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResourceListLess(tt.args.x, tt.args.y); got != tt.want {
				t.Errorf("ResourceListLess() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestResourceListAdd(t *testing.T) {
	type args struct {
		x corev1.ResourceList
		y corev1.ResourceList
	}
	tests := []struct {
		name string
		args args
		want corev1.ResourceList
	}{
		{
			name: "add two resource lists",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
			},
			want: corev1.ResourceList{
				corev1.ResourceCPU:    *resource.NewQuantity(2, resource.DecimalSI),
				corev1.ResourceMemory: *resource.NewQuantity(2048, resource.BinarySI),
			},
		},
		{
			name: "add two resource lists with extra fields in y",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU: *resource.NewQuantity(1, resource.DecimalSI),
				},
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
			},
			want: corev1.ResourceList{
				corev1.ResourceCPU:    *resource.NewQuantity(2, resource.DecimalSI),
				corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
			},
		},
		{
			name: "return if y nil",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
			},
			want: corev1.ResourceList{
				corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
				corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
			},
		},
		{
			name: "return if x nil",
			args: args{
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ResourceListAdd(tt.args.x, tt.args.y)
			if !ResourceListEqual(tt.args.x, tt.want) {
				t.Errorf("TestResourceListAdd() = %v, want %v", tt.args.x, tt.want)
			}
		})
	}
}

func TestResourceListSub(t *testing.T) {
	type args struct {
		x corev1.ResourceList
		y corev1.ResourceList
	}
	tests := []struct {
		name string
		args args
		want corev1.ResourceList
	}{
		{
			name: "substract y from x",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(2, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(2048, resource.BinarySI),
				},
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
			},
			want: corev1.ResourceList{
				corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
				corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
			},
		},
		{
			name: "substract y from x with extra fields in y",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU: *resource.NewQuantity(2, resource.DecimalSI),
				},
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
			},
			want: corev1.ResourceList{
				corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
				corev1.ResourceMemory: *resource.NewQuantity(-1024, resource.BinarySI),
			},
		},
		{
			name: "return if y nil",
			args: args{
				x: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
			},
			want: corev1.ResourceList{
				corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
				corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
			},
		},
		{
			name: "return if x nil",
			args: args{
				y: corev1.ResourceList{
					corev1.ResourceCPU:    *resource.NewQuantity(1, resource.DecimalSI),
					corev1.ResourceMemory: *resource.NewQuantity(1024, resource.BinarySI),
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ResourceListSub(tt.args.x, tt.args.y)
			if !ResourceListEqual(tt.args.x, tt.want) {
				t.Errorf("ResourceListSub() = %v, want %v", tt.args.x, tt.want)
			}
		})
	}
}
