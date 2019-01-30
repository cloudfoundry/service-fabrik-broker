package main

import (
	"context"
	"encoding/json"
	"errors"
	c "github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/resources"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/apis/instance/v1alpha1"

	"k8s.io/client-go/rest"

	"github.com/golang/glog"
	"k8s.io/api/admission/v1beta1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/manager"
)

// EventType denotes the types of metering events
type EventType string

const (
	//UpdateEvent signals the update of an instance
	UpdateEvent EventType = "update"
	//CreateEvent signals the create of an instance
	CreateEvent EventType = "create"
	//DeleteEvent signals the delete of an instance
	DeleteEvent EventType = "delete"
	//InvalidEvent is not yet supported
	InvalidEvent EventType = "default"
)

//LastOperationType
const (
	loUpdate string = "update"
	loCreate string = "create"
)

//State
const (
	Succeeded string = "succeeded"
	Delete    string = "delete"
)

// CrdKind
const (
	Director string = "Director"
	Docker   string = "Docker"
	SfeventKind  string = "Sfevent"
)

// Event stores the event details
type Event struct {
	AdmissionReview *v1beta1.AdmissionReview
	crd             resources.GenericResource
	oldCrd          resources.GenericResource
}

// NewEvent is a constructor for Event
func NewEvent(ar *v1beta1.AdmissionReview) (*Event, error) {
	arjson, err := json.Marshal(ar)
	req := ar.Request
	glog.Infof(`
    Creating event for
	%v
	Namespace=%v
	Request Name=%v
	UID=%v
	patchOperation=%v
	UserInfo=%v`,
		req.Kind,
		req.Namespace,
		req.Name,
		req.UID,
		req.Operation,
		req.UserInfo)
	crd, err := resources.GetGenericResource(ar.Request.Object.Raw)
	glog.Infof("Resource name : %v", crd.Name)
	if err != nil {
		glog.Errorf("Admission review JSON: %v", string(arjson))
		glog.Errorf("Could not get the GenericResource object %v", err)
		return nil, err
	}

	var oldCrd resources.GenericResource
	if len(ar.Request.OldObject.Raw) != 0 {
		oldCrd, err = resources.GetGenericResource(ar.Request.OldObject.Raw)
		if err != nil {
			glog.Errorf("Admission review JSON: %v", string(arjson))
			glog.Errorf("Could not get the old GenericResource object %v", err)
			return nil, err
		}
	} else {
		oldCrd = resources.GenericResource{}
	}

	return &Event{
		AdmissionReview: ar,
		crd:             crd,
		oldCrd:          oldCrd,
	}, nil
}

func (e *Event) isStateChanged() bool {
	glog.Infof("Checking state change new state: %s\n", e.crd.Status.State)
	glog.Infof("Checking state change old state: %s\n", e.oldCrd.Status.State)
	return e.crd.Status.State != e.oldCrd.Status.State
}

func (e *Event) isDeleteTriggered() bool {
	return e.crd.Status.State == Delete
}

func (e *Event) isPlanChanged() bool {
	appliedOptionsNew := e.crd.GetAppliedOptions()
	appliedOptionsOld := e.oldCrd.GetAppliedOptions()
	return appliedOptionsNew.PlanID != appliedOptionsOld.PlanID
}

func (e *Event) isCreate() (bool, error) {
	lo, err := e.crd.GetLastOperation()
	if err != nil {
		return false, err
	}
	return lo.Type == loCreate, nil
}

func (e *Event) isUpdate() (bool, error) {
	lo, err := e.crd.GetLastOperation()
	if err != nil {
		return false, err
	}
	return lo.Type == loUpdate, nil
}

func (e *Event) isSucceeded() bool {
	return e.crd.Status.State == Succeeded
}

func (e *Event) isDirector() bool {
	return e.crd.Kind == Director
}

func (e *Event) isDocker() bool {
	return e.crd.Kind == Docker
}

func (e *Event) isMeteringEvent() (bool, error) {
	// An event is metering event if
	// Create succeeded
	// or Update Succeeded
	// or Delete Triggered
	isUpdate, err := e.isUpdate()
	if err != nil {
		return false, err
	}
	isCreate, err := e.isCreate()
	if err != nil {
		return false, err
	}
	if e.isDirector() && e.isStateChanged() {
		if e.isSucceeded() {
			return (isUpdate && e.isPlanChanged()) || isCreate, nil
		}
		return e.isDeleteTriggered(), nil
	}
	return e.isDocker() && e.isStateChanged() && (e.isSucceeded() || e.isDeleteTriggered()), nil
}

// ObjectToMapInterface converts an Object to map[string]interface{}
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

func getClient(cfg *rest.Config) (client.Client, error) {
	glog.Infof("Get client for Apiserver")
	mgr, err := manager.New(cfg, manager.Options{})
	if err != nil {
		glog.Errorf("unable to set up overall controller manager %v", err)
		return nil, err
	}
	options := client.Options{
		Scheme: mgr.GetScheme(),
		Mapper: mgr.GetRESTMapper(),
	}
	apiserver, err := client.New(cfg, options)
	if err != nil {
		glog.Errorf("Unable to create kubernetes client %v", err)
		return nil, err
	}
	return apiserver, err
}

func meteringToUnstructured(m *v1alpha1.Sfevent) (*unstructured.Unstructured, error) {
	values, err := ObjectToMapInterface(m)
	if err != nil {
		glog.Errorf("unable convert to map interface %v", err)
		return nil, err
	}
	meteringDoc := &unstructured.Unstructured{}
	meteringDoc.SetUnstructuredContent(values)
	meteringDoc.SetKind(SfeventKind)
	meteringDoc.SetAPIVersion(c.InstanceAPIVersion)
	meteringDoc.SetNamespace(c.DefaultNamespace)
	meteringDoc.SetName(m.GetName())
	labels := make(map[string]string)
	labels[c.MeterStateKey] = c.ToBeMetered
	labels[c.InstanceGuidKey] = m.Spec.Options.ConsumerInfo.Instance
	meteringDoc.SetLabels(labels)
	return meteringDoc, nil
}

func (e *Event) getMeteringEvent(opt resources.GenericOptions, signal int) *v1alpha1.Sfevent {
	return newMetering(opt, e.crd, signal)
}

func (e *Event) getEventType() (EventType, error) {
	eventType := InvalidEvent
	lo, err := e.crd.GetLastOperation()
	if err != nil {
		return eventType, err
	}
	if e.crd.Status.State == Delete {
		eventType = DeleteEvent
	} else if e.isDirector() {
		switch lo.Type {
		case loUpdate:
			eventType = UpdateEvent
		case loCreate:
			eventType = CreateEvent
		}
	} else if e.isDocker() && e.crd.Status.State == Succeeded {
		eventType = CreateEvent
	}
	if eventType == InvalidEvent {
		return eventType, errors.New("No supported event found")
	}
	return eventType, nil
}

func (e *Event) getMeteringEvents() ([]*v1alpha1.Sfevent, error) {
	options, err := e.crd.Spec.GetOptions()
	if err != nil {
		return nil, err
	}
	oldAppliedOptions := e.oldCrd.GetAppliedOptions()
	var meteringDocs []*v1alpha1.Sfevent

	et, err := e.getEventType()
	if err != nil {
		return nil, err
	}
	switch et {
	case UpdateEvent:
		meteringDocs = append(meteringDocs, e.getMeteringEvent(options, c.MeterStart))
		meteringDocs = append(meteringDocs, e.getMeteringEvent(oldAppliedOptions, c.MeterStop))
	case CreateEvent:
		meteringDocs = append(meteringDocs, e.getMeteringEvent(options, c.MeterStart))
	case DeleteEvent:
		meteringDocs = append(meteringDocs, e.getMeteringEvent(oldAppliedOptions, c.MeterStop))
	}
	return meteringDocs, nil
}

func (e *Event) createMertering(cfg *rest.Config) error {
	apiserver, err := getClient(cfg)
	if err != nil {
		return err
	}
	events, err := e.getMeteringEvents()
	if err != nil {
		return err
	}
	for _, evt := range events {
		unstructuredDoc, err := meteringToUnstructured(evt)
		if err != nil {
			glog.Errorf("Error converting event : %v", err)
			return err
		}
		err = apiserver.Create(context.TODO(), unstructuredDoc)
		if err != nil {
			glog.Errorf("Error creating: %v", err)
			return err
		}
		glog.Infof("Successfully created metering resource")
	}
	return nil
}
