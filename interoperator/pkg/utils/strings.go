package utils

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
