package utils

import (
	"crypto/md5"
	"encoding/base64"
	"encoding/json"
)

//
// Helper functions to calculate checksum
//

// Finds checksum of the string
func CalculateHash(v interface{}) string {
	arrBytes := []byte{}
	jsonBytes, _ := json.Marshal(v)
	arrBytes = append(arrBytes, jsonBytes...)
	hash := md5.Sum(arrBytes)
	return base64.StdEncoding.EncodeToString(hash[:])
}
