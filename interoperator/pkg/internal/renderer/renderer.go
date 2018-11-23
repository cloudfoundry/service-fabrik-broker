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

package renderer

// Renderer is an interface for rendering templates from path, name, namespace and values.
type Renderer interface {
	Render(input Input) (Output, error)
}

// Input holds input to the renderer
type Input interface{}

// Output holds rendered templates files
type Output interface {
	Manifest() ([]byte, error)
	ManifestAsString() (string, error)
	FileContent(filename string) (string, error)
	ListFiles() ([]string, error)
}
