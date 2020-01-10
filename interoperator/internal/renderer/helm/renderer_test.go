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
	"io/ioutil"
	"reflect"
	"testing"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	chartapi "helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/chartutil"
	"k8s.io/client-go/kubernetes"
)

func TestNewInput(t *testing.T) {
	type args struct {
		chartPath      string
		releaseName    string
		namespace      string
		valuesTemplate string
		valuesInput    map[string]interface{}
	}
	tests := []struct {
		name string
		args args
		want renderer.Input
	}{
		{
			name: "return renderer input",
			args: args{
				chartPath:      "chartPath",
				releaseName:    "releaseName",
				namespace:      "namespace",
				valuesTemplate: "valuesTemplate",
				valuesInput:    nil,
			},
			want: helmInput{
				chartPath:      "chartPath",
				releaseName:    fmt.Sprintf("in-%s", utils.Adler32sum("releaseName")),
				namespace:      "namespace",
				valuesTemplate: "valuesTemplate",
				valuesInput:    nil,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewInput(tt.args.chartPath, tt.args.releaseName, tt.args.namespace, tt.args.valuesTemplate, tt.args.valuesInput); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewInput() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNew(t *testing.T) {
	type args struct {
		clientSet *kubernetes.Clientset
	}
	tests := []struct {
		name    string
		args    args
		want    renderer.Renderer
		wantErr bool
	}{
		{
			name: "create helm renderer",
			args: args{
				clientSet: nil,
			},
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := New(tt.args.clientSet)
			if (err != nil) != tt.wantErr {
				t.Errorf("New() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got == nil {
				t.Errorf("New() = %v, want Renderer", got)
			}
		})
	}
}

func Test_helmRenderer_Render(t *testing.T) {
	url := "https://raw.githubusercontent.com/cloudfoundry-incubator/service-fabrik-broker/gh-pages/helm-charts/interoperator-0.4.3.tgz"
	r, _ := New(nil)
	type args struct {
		rawInput renderer.Input
	}
	tests := []struct {
		name    string
		r       *helmRenderer
		args    args
		want    bool
		wantErr bool
	}{
		{
			name: "fail on invalid input",
			r:    r.(*helmRenderer),
			args: args{
				rawInput: nil,
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "fail when values fail to render",
			r:    r.(*helmRenderer),
			args: args{
				rawInput: helmInput{
					chartPath:      "chartPath",
					releaseName:    "releaseName",
					namespace:      "namespace",
					valuesTemplate: "a: {{ \"provision\" | unknown_function }}",
					valuesInput:    nil,
				},
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "fail when values fail to unmarshal",
			r:    r.(*helmRenderer),
			args: args{
				rawInput: helmInput{
					chartPath:      "chartPath",
					releaseName:    "releaseName",
					namespace:      "namespace",
					valuesTemplate: "valuesTemplate",
					valuesInput:    nil,
				},
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "fail when url fails to resolve",
			r:    r.(*helmRenderer),
			args: args{
				rawInput: helmInput{
					chartPath:      "chartPath",
					releaseName:    "releaseName",
					namespace:      "namespace",
					valuesTemplate: "name: name",
					valuesInput:    nil,
				},
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "render helm chart",
			r:    r.(*helmRenderer),
			args: args{
				rawInput: helmInput{
					chartPath:      url,
					releaseName:    "releaseName",
					namespace:      "namespace",
					valuesTemplate: "name: name",
					valuesInput:    nil,
				},
			},
			want:    true,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.r.Render(tt.args.rawInput)
			if (err != nil) != tt.wantErr {
				t.Errorf("helmRenderer.Render() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if (got != nil) != tt.want {
				t.Errorf("helmRenderer.Render() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_helmRenderer_processCRDS(t *testing.T) {
	r, _ := New(nil)
	ch1, err := loader.Load("./samples/postgresql")
	if err != nil {
		t.Errorf("helmRenderer.processCRDS() failed to load chart %v", err)
	}
	ch2, err := loader.Load("./samples/postgresql")
	if err != nil {
		t.Errorf("helmRenderer.processCRDS() failed to load chart %v", err)
	}
	ch1.AddDependency(ch2)

	output := make(map[string]string)

	sampleCRDFile, err := ioutil.ReadFile("./samples/postgresql/crds/sample.yaml")
	if err != nil {
		fmt.Printf("Failed to read sampleCRD file: %v\n", err)
		return
	}
	sampleCRD := string(sampleCRDFile)
	output["postgresql/charts/postgresql/crds/sample.yaml"] = sampleCRD
	output["postgresql/crds/sample.yaml"] = sampleCRD

	type args struct {
		ch *chartapi.Chart
	}
	tests := []struct {
		name    string
		r       *helmRenderer
		args    args
		want    map[string]string
		wantErr bool
	}{
		{
			name: "process crds of dependencies",
			r:    r.(*helmRenderer),
			args: args{
				ch: ch1,
			},
			want:    output,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.r.processCRDS(tt.args.ch)
			if (err != nil) != tt.wantErr {
				t.Errorf("helmRenderer.processCRDS() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("helmRenderer.processCRDS() = %v, want %v", got, tt.want)
			}
		})
	}
}

func Test_helmRenderer_renderResources(t *testing.T) {
	r, _ := New(nil)
	ch1, err := loader.Load("./samples/postgresql")
	if err != nil {
		t.Errorf("helmRenderer.renderResources() failed to load chart %v", err)
	}
	ch2, err := loader.Load("./samples/postgresql")
	if err != nil {
		t.Errorf("helmRenderer.renderResources() failed to load chart %v", err)
	}
	ch1.AddDependency(ch2)

	valuesToRender, err := chartutil.ToRenderValues(ch1, nil, chartutil.ReleaseOptions{
		Name:      "releaseName",
		Namespace: "namespace",
		Revision:  1,
		IsInstall: true,
	}, nil)
	if err != nil {
		t.Errorf("helmRenderer.renderResources() failed to create values. error =  %v", err)
	}

	type args struct {
		ch     *chartapi.Chart
		values chartutil.Values
	}
	tests := []struct {
		name    string
		r       *helmRenderer
		args    args
		want    bool
		wantErr bool
	}{
		{
			name: "fail if values are not valid",
			r:    r.(*helmRenderer),
			args: args{
				ch:     ch1,
				values: nil,
			},
			want:    false,
			wantErr: true,
		},
		{
			name: "render helm chart",
			r:    r.(*helmRenderer),
			args: args{
				ch:     ch1,
				values: valuesToRender,
			},
			want:    true,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.r.renderResources(tt.args.ch, tt.args.values)
			if (err != nil) != tt.wantErr {
				t.Errorf("helmRenderer.renderResources() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if (got != nil) != tt.want {
				t.Errorf("helmRenderer.renderResources() = %v, want %v", got, tt.want)
			}
		})
	}
}
