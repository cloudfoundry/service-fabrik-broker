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

package mutating

import (
	"context"
	"net/http"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	yaml "gopkg.in/yaml.v2"
	"sigs.k8s.io/controller-runtime/pkg/runtime/inject"
	"sigs.k8s.io/controller-runtime/pkg/webhook/admission"
	"sigs.k8s.io/controller-runtime/pkg/webhook/admission/types"
)

func init() {
	webhookName := constants.MutatingSFServiceInstanceWebhook
	if HandlerMap[webhookName] == nil {
		HandlerMap[webhookName] = []admission.Handler{}
	}
	HandlerMap[webhookName] = append(HandlerMap[webhookName], &SFServiceInstanceCreateUpdateHandler{})
}

// SFServiceInstanceCreateUpdateHandler handles SFServiceInstance.
type SFServiceInstanceCreateUpdateHandler struct {
	Decoder types.Decoder
}

func (h *SFServiceInstanceCreateUpdateHandler) mutatingSFServiceInstanceFn(obj *osbv1alpha1.SFServiceInstance) error {
	if obj.Labels == nil {
		obj.Labels = map[string]string{}
	}
	labels := make(map[string]interface{})
	if err := yaml.Unmarshal(obj.Spec.RawContext.Raw, &labels); err != nil {
		return err
	}
	for k, v := range labels {
		switch v.(type) {
		// Only the first level key-value pairs are added as labels in SFServiceInstance.
		case string:
			obj.Labels[k] = v.(string)
		}
	}
	return nil
}

var _ admission.Handler = &SFServiceInstanceCreateUpdateHandler{}

// Handle handles admission requests.
func (h *SFServiceInstanceCreateUpdateHandler) Handle(_ context.Context, req types.Request) types.Response {
	obj := &osbv1alpha1.SFServiceInstance{}
	if err := h.Decoder.Decode(req, obj); err != nil {
		return admission.ErrorResponse(http.StatusBadRequest, err)
	}
	objCopy := obj.DeepCopy()
	if err := h.mutatingSFServiceInstanceFn(objCopy); err != nil {
		return admission.ErrorResponse(http.StatusInternalServerError, err)
	}
	return admission.PatchResponse(obj, objCopy)
}

var _ inject.Decoder = &SFServiceInstanceCreateUpdateHandler{}

// InjectDecoder injects the decoder into the SFServiceInstanceCreateUpdateHandler.
func (h *SFServiceInstanceCreateUpdateHandler) InjectDecoder(d types.Decoder) error {
	h.Decoder = d
	return nil
}
