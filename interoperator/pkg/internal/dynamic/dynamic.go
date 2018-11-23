package dynamic

import (
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
		body = ConvertMapInterfaceToMapString(body)

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

// ConvertMapInterfaceToMapString converts map[interface{}]interface{}
// to map[string]interface{}
func ConvertMapInterfaceToMapString(v interface{}) interface{} {
	switch x := v.(type) {
	case map[interface{}]interface{}:
		m := map[string]interface{}{}
		for k, v2 := range x {
			switch k2 := k.(type) {
			case string:
				m[k2] = ConvertMapInterfaceToMapString(v2)
			default:
				m[fmt.Sprint(k)] = ConvertMapInterfaceToMapString(v2)
			}
		}
		v = m

	case []interface{}:
		for i, v2 := range x {
			x[i] = ConvertMapInterfaceToMapString(v2)
		}

	case map[string]interface{}:
		for k, v2 := range x {
			x[k] = ConvertMapInterfaceToMapString(v2)
		}
	}

	return v
}
