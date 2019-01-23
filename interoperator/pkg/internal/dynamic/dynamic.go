package dynamic

import (
	"encoding/json"
	"fmt"
	"strings"

	yaml "gopkg.in/yaml.v2"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// StringToUnstructured converts a yaml string to array of unstructured objects
func StringToUnstructured(contentString string) ([]*unstructured.Unstructured, error) {
	contents := strings.Split(contentString, "---")
	res := make([]*unstructured.Unstructured, 0, len(contents))

	for _, content := range contents {
		obj := &unstructured.Unstructured{}

		var body interface{}
		err := yaml.Unmarshal([]byte(content), &body)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal %s. %v", contentString, err)
		}
		body = MapInterfaceToMapString(body)

		switch x := body.(type) {
		case map[string]interface{}:
			obj.Object = x
		default:
			return nil, fmt.Errorf("failed to convert %s to unstructured", contentString)
		}
		res = append(res, obj)
	}
	return res, nil
}

// MapInterfaceToMapString converts map[interface{}]interface{}
// to map[string]interface{}
func MapInterfaceToMapString(v interface{}) interface{} {
	switch x := v.(type) {
	case map[interface{}]interface{}:
		m := map[string]interface{}{}
		for k, v2 := range x {
			switch k2 := k.(type) {
			case string:
				m[k2] = MapInterfaceToMapString(v2)
			default:
				m[fmt.Sprint(k)] = MapInterfaceToMapString(v2)
			}
		}
		v = m

	case []interface{}:
		for i, v2 := range x {
			x[i] = MapInterfaceToMapString(v2)
		}
	}

	return v
}

// ObjectToMapInterface converts an Object to map[interface{}]interface{}
func ObjectToMapInterface(obj interface{}) (map[string]interface{}, error) {
	values := make(map[string]interface{})
	options, err := json.Marshal(obj)
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(options, &values)
	if err != nil {
		return nil, err
	}
	return values, nil
}
