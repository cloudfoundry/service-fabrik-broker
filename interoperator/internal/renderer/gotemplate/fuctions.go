package gotemplate

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"text/template"

	"github.com/BurntSushi/toml"
	"github.com/Masterminds/sprig/v3"
	"sigs.k8s.io/yaml"
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

		"toToml":   toTOML,
		"toYaml":   toYAML,
		"fromYaml": fromYAML,
		"toJson":   toJSON,
		"fromJson": fromJSON,
	}
	for k, v := range localFuncMap {
		funcMap[k] = v
	}
	return funcMap
}

// toYAML takes an interface, marshals it to yaml, and returns a string. It will
// always return a string, even on marshal error (empty string).
//
// This is designed to be called from a template.
func toYAML(v interface{}) string {
	data, err := yaml.Marshal(v)
	if err != nil {
		// Swallow errors inside of a template.
		return ""
	}
	return strings.TrimSuffix(string(data), "\n")
}

// fromYAML converts a YAML document into a map[string]interface{}.
//
// This is not a general-purpose YAML parser, and will not parse all valid
// YAML documents. Additionally, because its intended use is within templates
// it tolerates errors. It will insert the returned error message string into
// m["Error"] in the returned map.
func fromYAML(str string) map[string]interface{} {
	m := map[string]interface{}{}

	if err := yaml.Unmarshal([]byte(str), &m); err != nil {
		m["Error"] = err.Error()
	}
	return m
}

// toTOML takes an interface, marshals it to toml, and returns a string. It will
// always return a string, even on marshal error (empty string).
//
// This is designed to be called from a template.
func toTOML(v interface{}) string {
	b := bytes.NewBuffer(nil)
	e := toml.NewEncoder(b)
	err := e.Encode(v)
	if err != nil {
		return err.Error()
	}
	return b.String()
}

// toJSON takes an interface, marshals it to json, and returns a string. It will
// always return a string, even on marshal error (empty string).
//
// This is designed to be called from a template.
func toJSON(v interface{}) string {
	data, err := json.Marshal(v)
	if err != nil {
		// Swallow errors inside of a template.
		return ""
	}
	return string(data)
}

// fromJSON converts a JSON document into a map[string]interface{}.
//
// This is not a general-purpose JSON parser, and will not parse all valid
// JSON documents. Additionally, because its intended use is within templates
// it tolerates errors. It will insert the returned error message string into
// m["Error"] in the returned map.
func fromJSON(str string) map[string]interface{} {
	m := make(map[string]interface{})

	if err := json.Unmarshal([]byte(str), &m); err != nil {
		m["Error"] = err.Error()
	}
	return m
}
