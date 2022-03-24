package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"strings"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/resources"
	"github.com/golang/glog"
	"k8s.io/api/admission/v1beta1"
	admissionregistrationv1beta1 "k8s.io/api/admissionregistration/v1beta1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/serializer"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/controller-runtime/pkg/client/config"
)

var (
	runtimeScheme = runtime.NewScheme()
	codecs        = serializer.NewCodecFactory(runtimeScheme)
	deserializer  = codecs.UniversalDeserializer()
)

// APIServerInterface exposes functions iteract with apiserver
type APIServerInterface interface {
	GetConfig() (*rest.Config, error)
}

// WebhookServer type holds the server details
type WebhookServer struct {
	server *http.Server
}

// APIServer hold apiserver params
type APIServer struct{}

// GetConfig get the config for apiserver
func (a *APIServer) GetConfig() (*rest.Config, error) {
	return config.GetConfig()
}

// WhSvrParameters hold webhook server parameters
type WhSvrParameters struct {
	port     int    // webhook server port
	certFile string // path to the x509 certificate for https
	keyFile  string // path to the x509 private key matching `CertFile`
}

func init() {
	_ = corev1.AddToScheme(runtimeScheme)
	_ = admissionregistrationv1beta1.AddToScheme(runtimeScheme)
	// defaulting with webhooks:
	// https://github.com/kubernetes/kubernetes/issues/57982
	//_ = v1.AddToScheme(runtimeScheme)
}

const (
	labelPatchTemplate string = `[
		 {"op":"add","path":"/metadata/labels/state","value":"%s"}
	]`
	newLabelPatchTemplate string = `[
		 {"op":"add","path":"/metadata/labels","value":{ "state": "%s"}}
	]`
)

// create mutation patch for resoures
func createPatch(resource *resources.GenericResource) []byte {
	if resource.Labels != nil {
		return []byte(fmt.Sprintf(labelPatchTemplate, strings.Replace(resource.Status.State, " ", "_", -1)))
	}
	return []byte(fmt.Sprintf(newLabelPatchTemplate, strings.Replace(resource.Status.State, " ", "_", -1)))
}

// main mutation process
func (whsvr *WebhookServer) mutate(ar *v1beta1.AdmissionReview) *v1beta1.AdmissionResponse {
	req := ar.Request
	var crd resources.GenericResource
	decoder := json.NewDecoder(bytes.NewReader(req.Object.Raw))
	//decoder.DisallowUnknownFields()
	if err := decoder.Decode(&crd); err != nil {
		glog.Errorf("Could not unmarshal raw object: %v", err)
		return &v1beta1.AdmissionResponse{
			Result: &metav1.Status{
				Message: err.Error(),
			},
		}
	}

	glog.Infof("AdmissionReview for Kind=%v, Namespace=%v Name=%v (%v) UID=%v patchOperation=%v UserInfo=%v",
		req.Kind, req.Namespace, req.Name, crd.Name, req.UID, req.Operation, req.UserInfo)

	r := &v1beta1.AdmissionResponse{
		Allowed: true,
		Patch:   createPatch(&crd),
		PatchType: func() *v1beta1.PatchType {
			pt := v1beta1.PatchTypeJSONPatch
			return &pt
		}(),
	}

	return r
}

func (whsvr *WebhookServer) meter(evt EventInterface, a APIServerInterface) *v1beta1.AdmissionResponse {
	glog.Info("Attempting to meter event")
	isMetering, err := evt.isMeteringEvent()
	if err != nil {
		return &v1beta1.AdmissionResponse{
			Result: &metav1.Status{
				Message: err.Error(),
			},
		}
	}
	if isMetering {
		cfg, err := a.GetConfig()
		if err != nil {
			glog.Errorf("Unable to set up client config %v", err)
			return &v1beta1.AdmissionResponse{
				Result: &metav1.Status{
					Message: err.Error(),
				},
			}
		}
		err = evt.createMertering(cfg)
		if err != nil {
			return &v1beta1.AdmissionResponse{
				Result: &metav1.Status{
					Message: err.Error(),
				},
			}
		}
	}
	return &v1beta1.AdmissionResponse{
		Allowed: true,
	}
}

// Serve method for webhook server
func (whsvr *WebhookServer) serve(w http.ResponseWriter, r *http.Request) {
	var body []byte
	if r.Body != nil {
		if data, err := ioutil.ReadAll(r.Body); err == nil {
			body = data
		}
	}
	if len(body) == 0 {
		glog.Error("empty body")
		http.Error(w, "empty body", http.StatusBadRequest)
		return
	}

	// verify the content type is accurate
	contentType := r.Header.Get("Content-Type")
	if contentType != "application/json" {
		glog.Errorf("Content-Type=%s, expect application/json", contentType)
		http.Error(w, "invalid Content-Type, expect `application/json`", http.StatusUnsupportedMediaType)
		return
	}

	var admissionResponse *v1beta1.AdmissionResponse
	ar := v1beta1.AdmissionReview{}
	if _, _, err := deserializer.Decode(body, nil, &ar); err != nil {
		glog.Errorf("Can't decode body: %v", err)
		admissionResponse = &v1beta1.AdmissionResponse{
			Result: &metav1.Status{
				Message: err.Error(),
			},
		}
	} else {
		glog.Info("Url path:", r.URL.Path)
		if r.URL.Path == "/mutate" {
			admissionResponse = whsvr.mutate(&ar)
		} else if r.URL.Path == "/meter" {
			evt, err := NewEvent(&ar)
			if err != nil {
				admissionResponse = &v1beta1.AdmissionResponse{
					Result: &metav1.Status{
						Message: err.Error(),
					},
				}
			} else {
				a := &APIServer{}
				admissionResponse = whsvr.meter(evt, a)
			}
		}
	}

	admissionReview := v1beta1.AdmissionReview{}
	if admissionResponse != nil {
		admissionReview.Response = admissionResponse
		if ar.Request != nil {
			admissionReview.Response.UID = ar.Request.UID
		}
	}

	resp, err := json.Marshal(admissionReview)
	if err != nil {
		glog.Errorf("Can't encode response: %v", err)
		http.Error(w, fmt.Sprintf("could not encode response: %v", err), http.StatusInternalServerError)
	}
	glog.Infof("Ready to write reponse ...")
	if _, err := w.Write(resp); err != nil {
		glog.Errorf("Can't write response: %v", err)
		http.Error(w, fmt.Sprintf("could not write response: %v", err), http.StatusInternalServerError)
	}
	glog.Flush()
}
