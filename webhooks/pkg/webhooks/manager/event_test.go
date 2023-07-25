package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/apis/instance/v1alpha1"
	c "github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/resources"
	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
	"k8s.io/api/admission/v1beta1"
	v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	types "k8s.io/apimachinery/pkg/types"
	watch "k8s.io/apimachinery/pkg/watch"
)

type clientMock struct {
	ErrorString string
	ListItems   *v1alpha1.SfeventList
}

func (c *clientMock) List(ctx context.Context, opts v1.ListOptions) (*v1alpha1.SfeventList, error) {
	if c.ErrorString != "" {
		return nil, errors.New(c.ErrorString)
	}
	return c.ListItems, nil
}
func (c *clientMock) Create(ctx context.Context, sfevent *v1alpha1.Sfevent, opts v1.CreateOptions) (*v1alpha1.Sfevent, error) {
	return nil, errors.New("Dummy Error")
}
func (c *clientMock) Delete(ctx context.Context, name string, opts v1.DeleteOptions) error {
	return errors.New("Dummy Error")
}
func (c *clientMock) DeleteCollection(ctx context.Context, opts v1.DeleteOptions, listOpts v1.ListOptions) error {
	return errors.New("Dummy Error")
}
func (c *clientMock) Patch(ctx context.Context, name string, pt types.PatchType, data []byte, opts v1.PatchOptions, subresources ...string) (result *v1alpha1.Sfevent, err error) {
	return nil, errors.New("Dummy Error")
}
func (c *clientMock) Watch(ctx context.Context, opts v1.ListOptions) (watch.Interface, error) {
	return nil, errors.New("Dummy Error")
}
func (c *clientMock) Get(ctx context.Context, name string, opts v1.GetOptions) (*v1alpha1.Sfevent, error) {
	return nil, errors.New("Dummy Error")
}
func (c *clientMock) Update(ctx context.Context, sfevent *v1alpha1.Sfevent, opts v1.UpdateOptions) (*v1alpha1.Sfevent, error) {
	return nil, errors.New("Dummy Error")
}
func (c *clientMock) UpdateStatus(ctx context.Context, sfevent *v1alpha1.Sfevent, opts v1.UpdateOptions) (result *v1alpha1.Sfevent, err error) {
	return nil, errors.New("Dummy Error")
}

var _ = Describe("Event", func() {
	var (
		ar             v1beta1.AdmissionReview
		arDockerCreate v1beta1.AdmissionReview
	)

	dat, err := os.ReadFile("test_resources/admission_request.json")
	if err != nil {
		panic(err)
	}

	dockerCreateAr, err := os.ReadFile("test_resources/admission_request_docker_create.json")
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
		It("Should set oldCrd empty if old object is empty", func() {
			ar.Request.OldObject.Raw = []byte("")
			evt, err := NewEvent(&ar)
			Expect(evt.oldCrd).To(Equal(resources.GenericResource{}))
			Expect(err).To(BeNil())
		})
		It("Should set oldCrd empty if old object cannot be parsed", func() {
			ar.Request.OldObject.Raw = []byte("invalid json")
			evt, err := NewEvent(&ar)
			Expect(evt).To(BeNil())
			Expect(err).ToNot(BeNil())
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
			// false for create triggered
		})
		Context("When Type is Create and kind is Docker", func() {
			It("Should should return true if create succeeds", func() {
				evt, _ := NewEvent(&arDockerCreate)
				evt.crd.Status.State = "succeeded"
				evt.oldCrd.Status.State = ""
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
				evt.oldCrd.Status.State = ""
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
			It("Should should return false if delete fails", func() {
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
		It("should return error if isUpdate fails", func() {
			evt, _ := NewEvent(&ar)
			evt.crd.Status.State = "succeeded"
			evt.oldCrd.Status.State = ""
			evt.crd.Status.LastOperationRaw = "invalid json"
			res, err := evt.isMeteringEvent()
			Expect(res).To(Equal(false))
			Expect(err).To(HaveOccurred())
		})

		It("should return error if isPlanChanged fails", func() {
			evt, _ := NewEvent(&ar)
			evt.crd.Status.State = "succeeded"
			evt.oldCrd.Status.State = ""
			evt.crd.Status.AppliedOptions = "invalid json"
			res, err := evt.isMeteringEvent()
			Expect(res).To(Equal(false))
			Expect(err).To(HaveOccurred())
		})
	})
	Describe("isUpdate", func() {
		It("Should throw error if GetLastOpertaion fails", func() {
			evt, _ := NewEvent(&arDockerCreate)
			evt.crd.Status.LastOperationRaw = "invalid json"
			_, err := evt.isUpdate()
			Expect(err).To(HaveOccurred())
		})
	})
	Describe("isCreate", func() {
		It("Should throw error if GetLastOpertaion fails", func() {
			evt, _ := NewEvent(&arDockerCreate)
			evt.crd.Status.LastOperationRaw = "invalid json"
			_, err := evt.isCreate()
			Expect(err).To(HaveOccurred())
		})
	})
	Describe("getEventType", func() {
		It("Should throw error if GetLastOpertaion fails", func() {
			evt, _ := NewEvent(&arDockerCreate)
			evt.crd.Status.LastOperationRaw = "invalid json"
			_, err := evt.getEventType()
			Expect(err).To(HaveOccurred())
		})
		It("Should detect docker create event", func() {
			evt, _ := NewEvent(&arDockerCreate)
			evt.crd.Kind = "Docker"
			evt.crd.Status.State = "succeeded"
			etype, err := evt.getEventType()
			Expect(etype).To(Equal(c.CreateEvent))
			Expect(err).To(BeNil())
		})
		It("Should return error if no condition matches", func() {
			evt, _ := NewEvent(&arDockerCreate)
			evt.crd.Kind = "Docker"
			etype, err := evt.getEventType()
			Expect(etype).To(Equal(c.InvalidEvent))
			Expect(err).To(HaveOccurred())
		})
	})
	Describe("isPlanChanged", func() {
		It("Should throw error if GetAppliedOption fails for new resource", func() {
			evt, _ := NewEvent(&arDockerCreate)
			evt.crd.Status.AppliedOptions = "invalid json"
			_, err := evt.isPlanChanged()
			Expect(err).To(HaveOccurred())
		})
		It("Should throw error if GetAppliedOption fails for old resource", func() {
			evt, _ := NewEvent(&arDockerCreate)
			evt.oldCrd.Status.AppliedOptions = "invalid json"
			_, err := evt.isPlanChanged()
			Expect(err).To(HaveOccurred())
		})
	})

	Describe("validateOptions", func() {
		It("Returns nil if options has necessary values", func() {
			evt, _ := NewEvent(&ar)
			co := resources.ContextOptions{
				Platform:         "fakePlatform",
				OrganizationGUID: "fakeOrganizationGuid",
				SpaceGUID:        "fakeSpaceGuid",
			}
			o := resources.GenericOptions{
				PlanID:    "new plan in options",
				ServiceID: "fakeServiceId",
				Context:   co,
			}
			err := evt.validateOptions(o)
			Expect(err).To(BeNil())
		})
		It("Throws error if ServiceID not found", func() {
			evt, _ := NewEvent(&ar)
			co := resources.ContextOptions{
				Platform:         "fakePlatform",
				OrganizationGUID: "fakeOrganizationGuid",
				SpaceGUID:        "fakeSpaceGuid",
			}
			o := resources.GenericOptions{
				PlanID:    "new plan in options",
				ServiceID: "",
				Context:   co,
			}
			err := evt.validateOptions(o)
			Expect(err).Should(HaveOccurred())
			Expect(err.Error()).To(Equal("ServiceID not found"))
		})
		It("Throws error if PlanID not found", func() {
			evt, _ := NewEvent(&ar)
			co := resources.ContextOptions{
				Platform:         "fakePlatform",
				OrganizationGUID: "fakeOrganizationGuid",
				SpaceGUID:        "fakeSpaceGuid",
			}
			o := resources.GenericOptions{
				PlanID:    "",
				ServiceID: "fake servie id",
				Context:   co,
			}
			err := evt.validateOptions(o)
			Expect(err).Should(HaveOccurred())
			Expect(err.Error()).To(Equal("PlanID not found"))
		})
		It("Throws error if Platform not found", func() {
			evt, _ := NewEvent(&ar)
			co := resources.ContextOptions{
				Platform:         "",
				OrganizationGUID: "fakeOrganizationGuid",
				SpaceGUID:        "fakeSpaceGuid",
			}
			o := resources.GenericOptions{
				PlanID:    "new plan in options",
				ServiceID: "fake service id",
				Context:   co,
			}
			err := evt.validateOptions(o)
			Expect(err).Should(HaveOccurred())
			Expect(err.Error()).To(Equal("Context.Platform not found"))
		})
		It("Throws error if OrganizationGUID not found", func() {
			evt, _ := NewEvent(&ar)
			co := resources.ContextOptions{
				Platform:         "fakePlatform",
				OrganizationGUID: "",
				SpaceGUID:        "fakeSpaceGuid",
			}
			o := resources.GenericOptions{
				PlanID:    "new plan in options",
				ServiceID: "fake service id",
				Context:   co,
			}
			err := evt.validateOptions(o)
			Expect(err).Should(HaveOccurred())
			Expect(err.Error()).To(Equal("Context.OrganizationGUID is not found"))
		})
		It("Throws error if SpaceGUID not found", func() {
			evt, _ := NewEvent(&ar)
			co := resources.ContextOptions{
				Platform:         "fakePlatform",
				OrganizationGUID: "fakeOrganizationGuid",
				SpaceGUID:        "",
			}
			o := resources.GenericOptions{
				PlanID:    "new plan in options",
				ServiceID: "fake service id",
				Context:   co,
			}
			err := evt.validateOptions(o)
			Expect(err).Should(HaveOccurred())
			Expect(err.Error()).To(Equal("Context.SpaceGUID is not found"))
		})
	})
	Describe("getMeteringEvents", func() {
		Context("when type is update", func() {
			It("Generates two metering docs", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.SetLastOperation(resources.GenericLastOperation{
					Type: "update",
				})

				co := resources.ContextOptions{
					Platform:         "fakePlatform",
					OrganizationGUID: "fakeOrganizationGuid",
					SpaceGUID:        "fakeSpaceGuid",
				}

				evt.crd.Spec.SetOptions(resources.GenericOptions{
					PlanID:    "new plan in options",
					ServiceID: "fakeServiceId",
					Context:   co})
				evt.crd.SetAppliedOptions(resources.GenericOptions{
					PlanID:    "newPlanUUID",
					ServiceID: "fakeServiceId",
					Context:   co})
				evt.oldCrd.SetAppliedOptions(resources.GenericOptions{
					PlanID:    "oldPlanUUID",
					ServiceID: "fakeServiceId",
					Context:   co})

				docs, err := evt.getMeteringEvents()
				Expect(err).To(BeNil())
				Expect(len(docs)).To(Equal(2))
				var docStart v1alpha1.SfeventOptions
				var docStop v1alpha1.SfeventOptions
				docStart = docs[0].Spec.Options
				docStop = docs[1].Spec.Options
				Expect(docStart.ServiceInfo.Plan).To(Equal("new plan in options"))
				Expect(docStop.InstancesMeasures[0].Value).To(Equal(c.MeterStop))
				Expect(docStop.ServiceInfo.Plan).To(Equal("oldPlanUUID"))
				Expect(docStart.InstancesMeasures[0].Value).To(Equal(c.MeterStart))
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
		Context("when type is delete", func() {
			It("Generates one metering doc", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.Status.State = "delete"
				docs, err := evt.getMeteringEvents()
				Expect(err).To(BeNil())
				Expect(len(docs)).To(Equal(1))
			})
			It("Should choose Options if docker", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.Kind = "Docker"
				evt.oldCrd.Status.AppliedOptions = ""
				evt.crd.Status.State = "delete"
				docs, err := evt.getMeteringEvents()
				Expect(err).To(BeNil())
				Expect(len(docs)).To(Equal(1))
			})
			It("Should throw error if Docker and Options is empty", func() {
				evt, _ := NewEvent(&ar)
				evt.crd.Kind = "Docker"
				evt.crd.Spec.Options = ""
				evt.oldCrd.Status.AppliedOptions = ""
				evt.crd.Status.State = "delete"
				docs, err := evt.getMeteringEvents()
				Expect(err).To(HaveOccurred())
				Expect(docs).To(BeNil())
			})
		})
		It("Should throw error when Options is empty", func() {
			evt, _ := NewEvent(&ar)
			evt.crd.Spec.Options = "{}"
			_, err := evt.getMeteringEvents()
			Expect(err).Should(HaveOccurred())
			Expect(err.Error()).To(Equal("ServiceID not found"))
		})
		It("Should throw error when AppliedOptions is empty when event type is update", func() {
			evt, _ := NewEvent(&ar)
			evt.crd.SetLastOperation(resources.GenericLastOperation{
				Type:  "update",
				State: "succeeded",
			})
			evt.oldCrd.Status.AppliedOptions = "{}"
			_, err := evt.getMeteringEvents()
			Expect(err).Should(HaveOccurred())
			Expect(err.Error()).To(Equal("ServiceID not found"))
		})
		It("Should throw error when Options is empty when event type is create", func() {
			evt, _ := NewEvent(&ar)
			evt.crd.SetLastOperation(resources.GenericLastOperation{
				Type:  "create",
				State: "succeeded",
			})
			evt.crd.Spec.Options = "{}"
			_, err := evt.getMeteringEvents()
			Expect(err).Should(HaveOccurred())
			Expect(err.Error()).To(Equal("ServiceID not found"))
		})
		It("Should throw error when AppliedOptions is empty and Options is empty", func() {
			evt, _ := NewEvent(&ar)
			evt.crd.Status.State = "delete"
			evt.crd.SetLastOperation(resources.GenericLastOperation{
				Type:  "delete",
				State: "delete",
			})
			evt.oldCrd.Status.AppliedOptions = "{}"
			evt.crd.Spec.Options = "{}"
			_, err := evt.getMeteringEvents()
			Expect(err).Should(HaveOccurred())
			Expect(err.Error()).To(Equal("ServiceID not found"))
		})
		It("Should throw error when getting Options fails", func() {
			evt, _ := NewEvent(&ar)
			evt.crd.Spec.Options = "invalid string"
			docs, err := evt.getMeteringEvents()
			Expect(err).Should(HaveOccurred())
			Expect(docs).To(BeNil())
		})
		It("Should throw error when getting old AppliedOption fails", func() {
			evt, _ := NewEvent(&ar)
			evt.oldCrd.Status.AppliedOptions = "invalid string"
			docs, err := evt.getMeteringEvents()
			Expect(err).Should(HaveOccurred())
			Expect(docs).To(BeNil())
		})
		It("Should return error if no condition matches", func() {
			evt, _ := NewEvent(&arDockerCreate)
			evt.crd.Kind = "Docker"
			docs, err := evt.getMeteringEvents()
			Expect(docs).To(BeNil())
			Expect(err).To(HaveOccurred())
		})
	})

	Describe("createMertering", func() {
		It("Should return failure if the CRD is not registered", func() {
			evt, _ := NewEvent(&ar)
			err := evt.createMertering(tcfg)
			Expect(err).Should(HaveOccurred())
			Expect(err.Error()).To(Equal("the server could not find the requested resource (post sfevents.instance.servicefabrik.io)"))
		})
	})

	Describe("isEventMetered", func() {
		It("Should return false if event type is not Delete", func() {
			evt := v1alpha1.Sfevent{}
			client := clientMock{}
			metered, err := isEventMetered(&evt, &client)
			Expect(err).To(BeNil())
			Expect(metered).To(Equal(false))
		})
		It("Should return error if List call fails", func() {
			evt := v1alpha1.Sfevent{}
			labels := make(map[string]string)
			labels[c.EventTypeKey] = string(c.DeleteEvent)
			evt.SetLabels(labels)
			client := clientMock{}
			client.ErrorString = "No resource found"
			metered, err := isEventMetered(&evt, &client)
			Expect(err.Error()).To(Equal("No resource found"))
			Expect(metered).To(Equal(false))
		})
		It("Should return true if Delete already sent", func() {
			evt := v1alpha1.Sfevent{}
			labels := make(map[string]string)
			labels[c.EventTypeKey] = string(c.DeleteEvent)
			evt.SetLabels(labels)
			client := clientMock{}
			client.ListItems = &v1alpha1.SfeventList{
				Items: []v1alpha1.Sfevent{{}},
			}
			metered, err := isEventMetered(&evt, &client)
			Expect(err).To(BeNil())
			Expect(metered).To(Equal(true))
		})
	})
})
