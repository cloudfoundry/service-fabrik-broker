/*
Copyright 2018 The Service Fabrik Authors.

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

package gotemplate

import (
	"bytes"
	"fmt"
	"text/template"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer"
)

type gotemplateRenderer struct {
	funcMap template.FuncMap
}

type gotemplateInput struct {
	content string
	name    string
	values  map[string]interface{}
}

// NewInput creates a new gotemplate Renderer input object.
func NewInput(url, content, name string, values map[string]interface{}) renderer.Input {
	if content != "" {
		return gotemplateInput{
			content: content,
			name:    name,
			values:  values,
		}
	}

	return nil
}

// New creates a new gotemplate Renderer object.
func New() (renderer.Renderer, error) {
	return &gotemplateRenderer{funcMap: getFuncMap()}, nil
}

// Render loads the chart from the given location <chartPath> and calls the Render() function
// to convert it into a renderer.Output object.
// TODO Consider using streams (io.Writer or io.Reader) in the API instead of buffers.
func (r *gotemplateRenderer) Render(rawInput renderer.Input) (renderer.Output, error) {
	input, ok := rawInput.(gotemplateInput)
	if !ok {
		return nil, fmt.Errorf("invalid input to gotemplate chart renderer")
	}
	engine, err := template.New(input.name).Funcs(r.funcMap).Parse(input.content)
	if err != nil {
		return nil, fmt.Errorf("can't create template from %s:, %s", input.name, err)
	}

	buf := new(bytes.Buffer)
	err = engine.Execute(buf, input.values)
	if err != nil {
		return nil, fmt.Errorf("can't render from %s:, %s", input.name, err)
	}

	return &gotemplateOutput{content: *buf}, nil
}
