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
	corev1 "k8s.io/api/core/v1"
)

// ResourceListEqual return true if ResourceList x is equal to y. Otherwise returns false
func ResourceListEqual(x, y corev1.ResourceList) bool {
	if len(x) != len(y) {
		return false
	}
	if x == nil || y == nil {
		// since length is same both are empty
		return true
	}

	for key, quantity := range x {
		quantity2, ok := y[key]
		if !ok || !quantity.Equal(quantity2) {
			return false
		}
	}

	return true
}

// ResourceListLess returns true if the ResourceList x is less to y, Otherwise return false
func ResourceListLess(x, y corev1.ResourceList) bool {
	if y == nil {
		return false
	}
	if x == nil {
		return true
	}
	for key, quantity := range x {
		quantity2, ok := y[key]
		if !ok || quantity.Cmp(quantity2) != -1 {
			return false
		}
	}

	return true
}

// ResourceListAdd adds the provided ResourceList y to the ResourceList x.
// If x or y is nil it just returns
// ResourceListAdd updates the value of x
func ResourceListAdd(x, y corev1.ResourceList) {
	if x == nil || y == nil {
		return
	}

	for key, quantity := range x {
		if quantity2, ok := y[key]; ok {
			quantity.Add(quantity2)
			x[key] = quantity
		}
	}

	// Add all missing fields in x from y
	for key, quantity2 := range y {
		if _, ok := x[key]; !ok {
			x[key] = quantity2
		}
	}
}

// ResourceListSub subtracts the provided ResourceList y from the ResourceList x.
// If x or y is nil it just returns
// ResourceListSub updates the value of x
func ResourceListSub(x, y corev1.ResourceList) {
	if x == nil || y == nil {
		return
	}

	for key, quantity := range x {
		if quantity2, ok := y[key]; ok {
			quantity.Sub(quantity2)
			x[key] = quantity
		}
	}

	// Add all missing fields in x from y
	for key, quantity2 := range y {
		if _, ok := x[key]; !ok {
			quantity2.Neg()
			x[key] = quantity2
		}
	}
}
