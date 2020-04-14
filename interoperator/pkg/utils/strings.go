package utils

import (
	"fmt"
	"hash/adler32"
)

//
// Helper functions to check and remove string from a slice of strings.
//

// ContainsString checks whether a string is contained
// within a slice
func ContainsString(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}

// RemoveString removes a given string from a slice
// and returns the new slice. RemoveString does not modify
// the input slice
func RemoveString(slice []string, s string) (result []string) {
	for _, item := range slice {
		if item == s {
			continue
		}
		result = append(result, item)
	}
	return
}

// Adler32sum function receives a string, and computes its Adler-32 checksum
// Use the same definition as used in gotemplate functions
func Adler32sum(input string) string {
	hash := adler32.Checksum([]byte(input))
	return fmt.Sprintf("%d", hash)
}
