package gotemplate

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"text/template"
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

func quote(str ...interface{}) string {
	out := make([]string, len(str))
	for i, s := range str {
		out[i] = fmt.Sprintf("%q", strval(s))
	}
	return strings.Join(out, " ")
}

func squote(str ...interface{}) string {
	out := make([]string, len(str))
	for i, s := range str {
		out[i] = fmt.Sprintf("'%v'", s)
	}
	return strings.Join(out, " ")
}

func strval(v interface{}) string {
	switch v := v.(type) {
	case string:
		return v
	default:
		return fmt.Sprintf("%v", v)
	}
}

func getFuncMap() template.FuncMap {
	funcMap := template.FuncMap{
		"b64enc":        encodeToString,
		"b64dec":        decodeString,
		"unmarshalJSON": unmarshalJSON,
		"marshalJSON":   marshalJSON,
		"quote":         quote,
		"squote":        squote,
	}
	return funcMap
}
