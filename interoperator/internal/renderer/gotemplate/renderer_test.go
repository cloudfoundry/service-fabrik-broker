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
	"reflect"
	"testing"
	"text/template"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer"
)

func TestNewInput(t *testing.T) {
	type args struct {
		url     string
		content string
		name    string
		values  map[string]interface{}
	}
	tests := []struct {
		name string
		args args
		want renderer.Input
	}{
		{
			name: "return renderer input",
			args: args{
				url:     "",
				content: "content",
				name:    "name",
				values:  nil,
			},
			want: gotemplateInput{
				content: "content",
				name:    "name",
				values:  nil,
			},
		},
		{
			name: "return nil if no content found",
			args: args{
				url:     "",
				content: "",
				name:    "name",
				values:  nil,
			},
			want: nil,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewInput(tt.args.url, tt.args.content, tt.args.name, tt.args.values); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewInput() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNew(t *testing.T) {
	tests := []struct {
		name    string
		wantErr bool
	}{
		{
			name:    "create gotemplate renderer",
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := New()
			if (err != nil) != tt.wantErr {
				t.Errorf("New() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got == nil || reflect.TypeOf(got) != reflect.TypeOf(&gotemplateRenderer{}) {
				t.Errorf("New() = %v, want renderer.Renderer", got)
			}
		})
	}
}

func Test_gotemplateRenderer_Render(t *testing.T) {
	funcMap := getFuncMap()
	values := make(map[string]interface{})
	values["value"] = "world"

	type fields struct {
		funcMap template.FuncMap
	}
	type args struct {
		rawInput renderer.Input
	}
	tests := []struct {
		name    string
		fields  fields
		args    args
		want    bool
		wantErr bool
		content string
	}{
		{
			name: "fail on invalid input",
			fields: fields{
				funcMap: funcMap,
			},
			args: args{
				rawInput: nil,
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "fail on invalid template",
			fields: fields{
				funcMap: funcMap,
			},
			args: args{
				rawInput: gotemplateInput{
					content: "content{{sd",
					name:    "name",
					values:  nil,
				},
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "fail on render fail",
			fields: fields{
				funcMap: funcMap,
			},
			args: args{
				rawInput: gotemplateInput{
					content: "{{ .value | .func }}",
					name:    "name",
					values:  nil,
				},
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "render go template",
			fields: fields{
				funcMap: funcMap,
			},
			args: args{
				rawInput: gotemplateInput{
					content: "hello {{ .value }}",
					name:    "name",
					values:  values,
				},
			},
			want:    true,
			wantErr: false,
			content: "hello world",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &gotemplateRenderer{
				funcMap: tt.fields.funcMap,
			}
			got, err := r.Render(tt.args.rawInput)
			if (err != nil) != tt.wantErr {
				t.Errorf("gotemplateRenderer.Render() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if _, ok := got.(renderer.Output); (got != nil) != tt.want || ok != tt.want {
				t.Errorf("gotemplateRenderer.Render() = %v, want %v", got, tt.want)
				return
			}
			if tt.want {
				out, err := got.FileContent("main")
				if err != nil {
					t.Errorf("gotemplateRenderer.Render() = result does not contain main file. error = %v", err)
					return
				}
				if out != tt.content {
					t.Errorf("gotemplateRenderer.Render() = result does not match. got = %v, want = %v", out, tt.content)
					return
				}
			}
		})
	}
}
