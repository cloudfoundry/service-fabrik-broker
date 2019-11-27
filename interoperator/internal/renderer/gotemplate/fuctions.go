package gotemplate

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"text/template"

	"github.com/Masterminds/sprig"
)

// encodeToString converts a string to base64 encoded string
func encodeToString(src string) string {
	return base64.StdEncoding.EncodeToString([]byte(src))
}

// decodeString converts base64 encoded string to string
func decodeString(src string) (string, error) {
	res, err := base64.StdEncoding.DecodeString(src)
	return string(res[:]), err
}

// unmarshalJSON converts stringified JSON to a map
func unmarshalJSON(src string) (map[string]interface{}, error) {
	res := make(map[string]interface{})
	err := json.Unmarshal([]byte(src), &res)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal %s. %v", src, err)
	}
	return res, err
}

// marshalJSON converts a map to a stringified JSON
func marshalJSON(src map[string]interface{}) (string, error) {
	options, err := json.Marshal(src)
	if err != nil {
		return "", err
	}
	return string(options[:]), err
}

func getFuncMap() template.FuncMap {
	funcMap := sprig.TxtFuncMap()
	localFuncMap := template.FuncMap{
		"b64enc":        encodeToString,
		"b64dec":        decodeString,
		"unmarshalJSON": unmarshalJSON,
		"marshalJSON":   marshalJSON,
	}
	for k, v := range localFuncMap {
		funcMap[k] = v
	}
	return funcMap
}
