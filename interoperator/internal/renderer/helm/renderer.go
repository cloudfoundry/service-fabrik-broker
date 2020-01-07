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
	"os"
	"path"
	"strings"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer/gotemplate"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"k8s.io/client-go/kubernetes"

	chartapi "helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/downloader"
	"helm.sh/helm/v3/pkg/engine"
	"helm.sh/helm/v3/pkg/getter"
)

var (
	ignoreFileSuffix = [...]string{"NOTES.txt"}
)

type helmRenderer struct {
	chartDownloader    *downloader.ChartDownloader
	gotemplateRenderer renderer.Renderer
}

type helmInput struct {
	chartPath      string
	releaseName    string
	namespace      string
	valuesTemplate string
	valuesInput    map[string]interface{}
}

// NewInput creates a new helm Renderer input object.
func NewInput(chartPath, releaseName, namespace string, valuesTemplate string, valuesInput map[string]interface{}) renderer.Input {
	shortName := fmt.Sprintf("in-%s", utils.Adler32sum(releaseName))
	return helmInput{
		chartPath:      chartPath,
		releaseName:    shortName,
		namespace:      namespace,
		valuesTemplate: valuesTemplate,
		valuesInput:    valuesInput,
	}
}

// New creates a new helm Renderer object.
func New(clientSet *kubernetes.Clientset) (renderer.Renderer, error) {
	chartDownloader := &downloader.ChartDownloader{
		Out: os.Stdout,
		Getters: getter.Providers{getter.Provider{
			Schemes: []string{"http", "https"},
			New:     getter.NewHTTPGetter,
		}},
	}
	gotemplateRenderer, err := gotemplate.New()
	if err != nil {
		return nil, err
	}
	return &helmRenderer{
		chartDownloader:    chartDownloader,
		gotemplateRenderer: gotemplateRenderer,
	}, nil
}

// Render loads the chart from the given location <chartPath> and calls the Render() function
// to convert it into a renderer.Output object.
// TODO Consider using streams (io.Writer or io.Reader) in the API instead of buffers.
func (r *helmRenderer) Render(rawInput renderer.Input) (renderer.Output, error) {
	input, ok := rawInput.(helmInput)
	if !ok {
		return nil, errors.NewRendererError("helm", "invalid input to renderer", nil)
	}

	var valuesString string

	if input.valuesTemplate != "" {
		gotemplateInput := gotemplate.NewInput("", input.valuesTemplate, input.releaseName, input.valuesInput)
		gotemplateOutput, err := r.gotemplateRenderer.Render(gotemplateInput)
		if err != nil {
			return nil, errors.NewRendererError("helm", "failed to render values", err)
		}
		valuesString, err = gotemplateOutput.FileContent("main")
		if err != nil {
			return nil, errors.NewRendererError("helm", "failed to read rendered values", err)
		}
	}

	values, err := chartutil.ReadValues([]byte(valuesString))
	if err != nil {
		return nil, errors.NewRendererError("helm", "failed to parse rendered values", err)
	}

	chartDownloader := r.chartDownloader
	chartURL, err := chartDownloader.ResolveChartVersion(input.chartPath, "")
	if err != nil {
		return nil, err
	}

	dir, err := ioutil.TempDir("", "helm")
	if err != nil {
		return nil, err
	}

	defer os.RemoveAll(dir)

	path, _, err := chartDownloader.DownloadTo(chartURL.String(), "", dir)
	if err != nil {
		return nil, err
	}

	chart, err := loader.Load(path)
	if err != nil {
		return nil, err
	}

	return r.renderRelease(chart, input.releaseName, input.namespace, values)
}

func (r *helmRenderer) renderRelease(chart *chartapi.Chart, releaseName, namespace string, values map[string]interface{}) (renderer.Output, error) {
	chartName := chart.Name()

	valuesToRender, err := chartutil.ToRenderValues(chart, values, chartutil.ReleaseOptions{
		Name:      releaseName,
		Namespace: namespace,
		Revision:  1,
		IsInstall: true,
	}, nil)
	if err != nil {
		return nil, errors.NewRendererError("helm", fmt.Sprintf("can't parse variables for chart %s", chartName), err)
	}

	err = chartutil.ProcessDependencies(chart, valuesToRender)
	if err != nil {
		return nil, errors.NewRendererError("helm", fmt.Sprintf("can't process dependencies for chart %s", chartName), err)
	}

	return r.renderResources(chart, valuesToRender)
}

func (r *helmRenderer) renderResources(ch *chartapi.Chart, values chartutil.Values) (renderer.Output, error) {
	files, err := engine.Render(ch, values)
	if err != nil {
		return nil, err
	}

	CRDs, err := r.processCRDS(ch)
	if err != nil {
		return nil, err
	}
	for key, data := range CRDs {
		files[key] = string(data)
	}

	// Remove NODES.txt and partials
	for k := range files {
		if strings.HasPrefix(path.Base(k), "_") {
			delete(files, k)
			continue
		}
		for _, suffix := range ignoreFileSuffix {
			if strings.HasSuffix(k, suffix) {
				delete(files, k)
				break
			}
		}
	}

	return &helmOutput{
		Name:  ch.Metadata.Name,
		Files: files,
	}, nil
}

func (r *helmRenderer) processCRDS(ch *chartapi.Chart) (map[string]string, error) {
	crds := make(map[string]string)
	for _, cr := range ch.CRDs() {
		//Add chart name so that crds are applied first
		key := fmt.Sprintf("%s/%s", ch.Name(), cr.Name)
		crds[key] = string(cr.Data)
	}

	for _, dependency := range ch.Dependencies() {
		dependencyCRDs, err := r.processCRDS(dependency)
		if err != nil {
			return nil, err
		}
		for crName, data := range dependencyCRDs {
			key := fmt.Sprintf("%s/charts/%s", ch.Name(), crName)
			crds[key] = data
		}
	}

	return crds, nil
}
