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

package helm

import (
	"fmt"
	"sort"
)

type helmOutput struct {
	Name  string
	Files map[string]string
}

// FileContent returns explicitly the content of the provided <filename>.
func (c *helmOutput) FileContent(filename string) (string, error) {
	contentString, ok := c.Files[filename]
	if !ok {
		return "", fmt.Errorf("file %s not found in rendered helm chart output", filename)
	}
	return contentString, nil
}

// ListFiles returns list of file names rendered
func (c *helmOutput) ListFiles() ([]string, error) {
	fileNames := make([]string, 0, len(c.Files))
	for k := range c.Files {
		fileNames = append(fileNames, k)
	}
	sort.Strings(fileNames)
	return fileNames, nil
}
