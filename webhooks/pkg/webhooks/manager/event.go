package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/apis/instance/v1alpha1"
	instanceclient "github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/client/clientset/versioned/typed/instance/v1alpha1"
	c "github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/meter"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/resources"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"k8s.io/client-go/rest"

	"github.com/golang/glog"
	"k8s.io/api/admission/v1beta1"
)

// LastOperationType
const (
	loUpdate string = "update"
	loCreate string = "create"
)

// State
const (
	Succeeded string = "succeeded"
	Delete    string = "delete"
)

// CrdKind
const (
	Director    string = "Director"
	Docker      string = "Docker"
	SfeventKind string = "Sfevent"
)

// EventInterface exposes generic functions of any events
type EventInterface interface {
	isMeteringEvent() (bool, error)
	createMertering(cfg *rest.Config) error
}

// Event stores the event details
type Event struct {
	AdmissionReview *v1beta1.AdmissionReview
	crd             resources.GenericResource
	oldCrd          resources.GenericResource
}

// NewEvent is a constructor for Event
func NewEvent(ar *v1beta1.AdmissionReview) (*Event, error) {
	arjson, _ := json.Marshal(ar)
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

	var oldCrd resources.GenericResource = resources.GenericResource{}
	if len(ar.Request.OldObject.Raw) != 0 {
		oldCrd, err = resources.GetGenericResource(ar.Request.OldObject.Raw)
		if err != nil {
			glog.Errorf("Admission review JSON: %v", string(arjson))
			glog.Errorf("Could not get the old GenericResource object %v", err)
			return nil, err
		}
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

func (e *Event) isPlanChanged() (bool, error) {
	appliedOptionsNew, err := e.crd.GetAppliedOptions()
	if err != nil {
		return false, err
	}
	appliedOptionsOld, err := e.oldCrd.GetAppliedOptions()
	if err != nil {
		return false, err
	}
	return appliedOptionsNew.PlanID != appliedOptionsOld.PlanID, nil
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
	if e.isDirector() && e.isStateChanged() {
		if e.isSucceeded() {
			isUpdate, err := e.isUpdate()
			if err != nil {
				return false, err
			}
			isCreate, err := e.isCreate()
			if err != nil {
				return false, err
			}
			isPlanChanged, err := e.isPlanChanged()
			if err != nil {
				return false, err
			}
			return (isUpdate && isPlanChanged) || isCreate, nil
		}
		return e.isDeleteTriggered(), nil
	}
	return e.isDocker() && e.isStateChanged() && (e.isSucceeded() || e.isDeleteTriggered()), nil
}

func getClient(cfg *rest.Config) (instanceclient.SfeventInterface, error) {
	controller, err := instanceclient.NewForConfig(cfg)
	if err != nil {
		glog.Errorf("unable to set up overall controller manager %v", err)
		return nil, err
	}
	client := controller.Sfevents(c.DefaultNamespace)
	return client, nil
}

func (e *Event) getMeteringEvent(opt resources.GenericOptions, startStop int, et c.EventType) *v1alpha1.Sfevent {
	return meter.NewMetering(opt, e.crd, startStop, et)
}

func (e *Event) getEventType() (c.EventType, error) {
	eventType := c.InvalidEvent
	lo, err := e.crd.GetLastOperation()
	if err != nil {
		return eventType, err
	}
	if e.crd.Status.State == Delete {
		eventType = c.DeleteEvent
	} else if e.isDirector() {
		switch lo.Type {
		case loUpdate:
			eventType = c.UpdateEvent
		case loCreate:
			eventType = c.CreateEvent
		}
	} else if e.isDocker() && e.crd.Status.State == Succeeded {
		eventType = c.CreateEvent
	}
	if eventType == c.InvalidEvent {
		return eventType, errors.New("no supported event found")
	}
	return eventType, nil
}

func (e *Event) getMeteringEvents() ([]*v1alpha1.Sfevent, error) {
	options, err := e.crd.Spec.GetOptions()
	if err != nil {
		return nil, err
	}
	oldAppliedOptions, err := e.oldCrd.GetAppliedOptions()
	if err != nil {
		return nil, err
	}
	var meteringDocs []*v1alpha1.Sfevent

	et, err := e.getEventType()
	if err != nil {
		return nil, err
	}
	switch et {
	case c.UpdateEvent:
		if err = e.validateOptions(options); err != nil {
			return nil, err
		}
		if err = e.validateOptions(oldAppliedOptions); err != nil {
			return nil, err
		}
		meteringDocs = append(meteringDocs, e.getMeteringEvent(options, c.MeterStart, c.UpdateEvent))
		meteringDocs = append(meteringDocs, e.getMeteringEvent(oldAppliedOptions, c.MeterStop, c.UpdateEvent))
	case c.CreateEvent:
		if err = e.validateOptions(options); err != nil {
			return nil, err
		}
		meteringDocs = append(meteringDocs, e.getMeteringEvent(options, c.MeterStart, c.CreateEvent))
	case c.DeleteEvent:
		chosenOptions := oldAppliedOptions
		// When create fails , field of appliedOptions can be empty
		// In such cases chose options
		if chosenOptions.ServiceID == "" {
			chosenOptions = options
		}
		if err = e.validateOptions(chosenOptions); err != nil {
			return nil, err
		}
		meteringDocs = append(meteringDocs, e.getMeteringEvent(chosenOptions, c.MeterStop, c.DeleteEvent))
	}
	return meteringDocs, nil
}

func (e *Event) validateOptions(opt resources.GenericOptions) error {
	if opt.ServiceID == "" {
		return errors.New("ServiceID not found")
	} else if opt.PlanID == "" {
		return errors.New("PlanID not found")
	} else if opt.Context.Platform == "" {
		return errors.New("Context.Platform not found")
	} else if opt.Context.OrganizationGUID == "" {
		return errors.New("Context.OrganizationGUID is not found")
	} else if opt.Context.SpaceGUID == "" {
		return errors.New("Context.SpaceGUID is not found")
	}
	return nil
}

// Checks if the event is already created in apiserver
// If The event is of type delete
// check if it is already created
func isEventMetered(evt *v1alpha1.Sfevent, client instanceclient.SfeventInterface) (bool, error) {
	labels := evt.GetLabels()
	if labels[c.EventTypeKey] == string(c.DeleteEvent) {
		list, err := client.List(context.TODO(), v1.ListOptions{
			LabelSelector: fmt.Sprintf("%s=%s,%s=%s", c.EventTypeKey, string(c.DeleteEvent), c.InstanceGUIDKey, evt.Spec.Options.ConsumerInfo.Instance),
		})
		if err != nil {
			glog.Errorf("Error fetching list : %v", err)
			return false, err
		}
		if len(list.Items) > 0 {
			glog.Errorf("Delete Already sent %v", list.Items)
			return true, nil
		}
	}
	return false, nil
}

func (e *Event) createMertering(cfg *rest.Config) error {
	client, err := getClient(cfg)
	if err != nil {
		glog.Errorf("Error creating sfevent client : %v", err)
		return err
	}
	sfevents, err := e.getMeteringEvents()
	if err != nil {
		glog.Errorf("Error fetching metering events : %v", err)
		return err
	}
	for _, evt := range sfevents {
		metered, err := isEventMetered(evt, client)
		if err != nil {
			glog.Errorf("Error checking if event is metered : %v", err)
			return err
		}
		if !metered {
			r, err := client.Create(context.TODO(), evt, v1.CreateOptions{})
			if err != nil {
				glog.Errorf("Error creating event : %v", err)
				return err
			}
			glog.Infof("Successfully created metering resource %v", r)
		}
	}
	return nil
}
