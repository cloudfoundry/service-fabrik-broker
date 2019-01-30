package main

import (
	"encoding/json"
	c "github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/resources"
	"io/ioutil"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
	"k8s.io/api/admission/v1beta1"
)

var _ = Describe("Event", func() {
	var (
		ar             v1beta1.AdmissionReview
		arDockerCreate v1beta1.AdmissionReview
	)
	dat, err := ioutil.ReadFile("test_resources/admission_request.json")
	dockerCreateAr, err := ioutil.ReadFile("test_resources/admission_request_docker_create.json")
	if err != nil {
		panic(err)
	}

	BeforeEach(func() {
		err = json.Unmarshal(dat, &ar)
		if err != nil {
			panic(err)
		}
		err = json.Unmarshal(dockerCreateAr, &arDockerCreate)
		if err != nil {
			panic(err)
		}
	})

	Describe("NewEvent", func() {
		It("Should create a new Event object", func() {
			evt, err := NewEvent(&ar)
			Expect(evt).ToNot(Equal(nil), "Should return an event object")
			Expect(evt.crd.GetLastOperation()).To(Equal(resources.GenericLastOperation{
				Type:  "create",
				State: "succeeded",
			}), "Should return an event object with valid LastOperation")
			Expect(err).To(BeNil())
		})
		It("Should throw error if object cannot be parsed", func() {
			temp := ar.Request.Object.Raw
			ar.Request.Object.Raw = []byte("")
			evt, err := NewEvent(&ar)
			Expect(evt).To(BeNil())
			Expect(err).ToNot(BeNil())
			ar.Request.Object.Raw = temp
		})
		It("Should set oldCrd empty if old object cannot be parsed", func() {
			ar.Request.OldObject.Raw = []byte("")
			evt, err := NewEvent(&ar)
			Expect(evt.oldCrd).To(Equal(resources.GenericResource{}))
			Expect(err).To(BeNil())
		})
	})
	Describe("isMeteringEvent", func() {
		Context("When Type is Update and kind is Director", func() {
			It("Should should return true if update with plan change succeeds", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.Status.State = "succeeded"
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type:  "update",
					State: "succeeded",
				})
				evt.oldCrd.SetLastOperation(resources.GenericLastOperation{
					Type:  "update",
					State: "in_progress",
				})
				evt.oldCrd.Status.State = "in_progress"
				evt.crd.SetAppliedOptions(resources.GenericOptions{PlanID: "newPlanUUID"})
				evt.oldCrd.SetAppliedOptions(resources.GenericOptions{PlanID: "oldPlanUUID"})
				Expect(evt.isMeteringEvent()).To(Equal(true))
			})
			It("Should should return false if update with no plan change succeeds", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.Status.State = "succeeded"
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type:  "update",
					State: "succeeded",
				})
				evt.oldCrd.SetLastOperation(resources.GenericLastOperation{
					Type:  "update",
					State: "in_progress",
				})
				evt.oldCrd.Status.State = "in_progress"
				evt.crd.SetAppliedOptions(resources.GenericOptions{PlanID: "PlanUUID"})
				evt.oldCrd.SetAppliedOptions(resources.GenericOptions{PlanID: "PlanUUID"})
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
			It("Should should return false if state does not change", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.Status.State = "succeeded"
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type:  "update",
					State: "succeeded",
				})
				evt.oldCrd.SetLastOperation(resources.GenericLastOperation{
					Type:  "update",
					State: "succeeded",
				})
				evt.oldCrd.Status.State = "succeeded"
				evt.crd.SetAppliedOptions(resources.GenericOptions{PlanID: "newPlanUUID"})
				evt.oldCrd.SetAppliedOptions(resources.GenericOptions{PlanID: "oldPlanUUID"})
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
			It("Should should return false if update fails", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type:  "update",
					State: "failed",
				})
				evt.crd.Status.State = "failed"
				evt.oldCrd.SetLastOperation(resources.GenericLastOperation{
					Type:  "update",
					State: "in_progress",
				})
				evt.oldCrd.Status.State = "in_progress"
				evt.crd.SetAppliedOptions(resources.GenericOptions{PlanID: "newPlanUUID"})
				evt.oldCrd.SetAppliedOptions(resources.GenericOptions{PlanID: "oldPlanUUID"})
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
		})
		Context("When Type is Create and kind is Director", func() {
			It("Should should return true if create succeeds", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.Status.State = "succeeded"
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type:  "create",
					State: "succeeded",
				})
				evt.oldCrd.SetLastOperation(resources.GenericLastOperation{
					Type:  "create",
					State: "in_progress",
				})
				evt.oldCrd.Status.State = "in_progress"
				evt.crd.SetAppliedOptions(resources.GenericOptions{PlanID: "PlanUUID"})
				evt.oldCrd.SetAppliedOptions(resources.GenericOptions{PlanID: "PlanUUID"})
				Expect(evt.isMeteringEvent()).To(Equal(true))
			})
			It("Should should return false if create state change does not change", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.Status.State = "succeeded"
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type:  "create",
					State: "succeeded",
				})
				evt.oldCrd.SetLastOperation(resources.GenericLastOperation{
					Type:  "create",
					State: "succeeded",
				})
				evt.oldCrd.Status.State = "succeeded"
				evt.crd.SetAppliedOptions(resources.GenericOptions{PlanID: "newPlanUUID"})
				evt.oldCrd.SetAppliedOptions(resources.GenericOptions{PlanID: "oldPlanUUID"})
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
			It("Should should return false if create fails", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type: "create",
				})
				evt.crd.Status.State = "failed"
				evt.oldCrd.SetLastOperation(resources.GenericLastOperation{
					Type: "create",
				})
				evt.oldCrd.Status.State = "in_progress"
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
		})
		Context("When Type is Create and kind is Docker", func() {
			It("Should should return true if create succeeds", func() {
				evt, _ := NewEvent(&arDockerCreate)
				evt.crd.Status.State = "succeeded"
				evt.oldCrd.Status.State = "in_progress"
				Expect(evt.isMeteringEvent()).To(Equal(true))
			})
			It("Should should return false if create state change does not change", func() {
				evt, _ := NewEvent(&arDockerCreate)
				evt.crd.Status.State = "succeeded"
				evt.oldCrd.Status.State = "succeeded"
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
			It("Should should return false if create fails", func() {
				evt, _ := NewEvent(&arDockerCreate)
				evt.crd.Status.State = "failed"
				evt.oldCrd.Status.State = "in_progress"
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
		})
		Context("When Type is Delete and kind is Director", func() {
			It("Should should return true if delete is triggered", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.Status.State = "delete"
				evt.oldCrd.Status.State = "succeeded"
				Expect(evt.isMeteringEvent()).To(Equal(true))
			})
			It("Should should return false when delete state change does not change", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.Status.State = "delete"
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type: "delete",
				})
				evt.oldCrd.Status.State = "delete"
				evt.oldCrd.SetLastOperation(resources.GenericLastOperation{
					Type: "delete",
				})
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
			It("Should should return false if create fails", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type: "delete",
				})
				evt.crd.Status.State = "failed"
				evt.oldCrd.Status.State = "delete"
				evt.oldCrd.SetLastOperation(resources.GenericLastOperation{
					Type: "delete",
				})
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
		})
		Context("When Type is Delete and kind is Docker", func() {
			It("Should should return true if delete is triggered", func() {
				evt, _ := NewEvent(&arDockerCreate)
				evt.crd.Status.State = "delete"
				evt.oldCrd.Status.State = "succeeded"
				Expect(evt.isMeteringEvent()).To(Equal(true))
			})
			It("Should should return false when delete state change does not change", func() {
				evt, _ := NewEvent(&arDockerCreate)
				evt.crd.Status.State = "delete"
				evt.oldCrd.Status.State = "delete"
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
			It("Should should return false if create fails", func() {
				evt, _ := NewEvent(&arDockerCreate)
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type: "delete",
				})
				evt.crd.Status.State = "failed"
				evt.oldCrd.Status.State = "delete"
				evt.oldCrd.SetLastOperation(resources.GenericLastOperation{
					Type: "delete",
				})
				Expect(evt.isMeteringEvent()).To(Equal(false))
			})
		})
	})

	Describe("ObjectToMapInterface", func() {
		It("Should convert object to map", func() {
			expected := make(map[string]interface{})
			expected["options"] = "dummyOptions"
			Expect(ObjectToMapInterface(resources.GenericSpec{
				Options: "dummyOptions",
			})).To(Equal(expected))
		})
	})

	Describe("meteringToUnstructured", func() {
		It("Creates unstructured metering instance", func() {
			m := Sfevent{
				Spec: MeteringSpec{
					Options: MeteringOptions{},
				},
			}
			val, err := meteringToUnstructured(&m)
			Expect(err).To(BeNil())
			Expect(val).ToNot(BeNil())
			Expect(val.GetKind()).To(Equal("Sfevent"))
			Expect(val.GetAPIVersion()).To(Equal("instance.servicefabrik.io/v1alpha1"))
			Expect(val.GetLabels()[c.MeterStateKey]).To(Equal(c.ToBeMetered))

		})
	})

	Describe("getMeteringEvents", func() {
		Context("when type is update", func() {
			It("Generates two metering docs", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type: "update",
				})

				evt.crd.Spec.SetOptions(resources.GenericOptions{PlanID: "new plan in options"})
				evt.crd.SetAppliedOptions(resources.GenericOptions{PlanID: "newPlanUUID"})
				evt.oldCrd.SetAppliedOptions(resources.GenericOptions{PlanID: "oldPlanUUID"})

				docs, err := evt.getMeteringEvents()
				Expect(err).To(BeNil())
				Expect(len(docs)).To(Equal(2))
				var docStart MeteringOptions
				var docStop MeteringOptions
				docStart = docs[0].Spec.Options
				docStop = docs[1].Spec.Options
				Expect(docStart.ServiceInfo.Plan).To(Equal("new plan in options"))
				Expect(docStart.InstancesMeasures[0].Value).To(Equal(c.MeterStart))
				Expect(docStop.ServiceInfo.Plan).To(Equal("oldPlanUUID"))
				Expect(docStop.InstancesMeasures[0].Value).To(Equal(c.MeterStop))
			})
		})
		Context("when type is create", func() {
			It("Generates one metering doc", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type: "create",
				})
				docs, err := evt.getMeteringEvents()
				Expect(err).To(BeNil())
				Expect(len(docs)).To(Equal(1))
			})
		})
	})
})
