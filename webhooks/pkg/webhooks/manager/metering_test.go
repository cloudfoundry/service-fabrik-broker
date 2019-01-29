package main

import (
	// "encoding/json"

	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
	c "github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/resources"
)

var _ = Describe("Metering", func() {
	Describe("newMetering", func() {
		It("it should create the metering object", func() {
			//Create params
			co := resources.ContextOptions{
				Platform:         "test-platform",
				OrganizationGUID: "test-org-guid",
				SpaceGUID:        "test-space",
			}
			opt := resources.GenericOptions{
				ServiceID: "test-service-id",
				PlanID:    "test-plan-id",
				Context:   co,
			}
			crd := resources.GenericResource{}
			signal := c.MeterStop
			// Test creating metering object
			m := newMetering(opt, crd, signal)
			var unmarsheledMeteringOptions MeteringOptions
			unmarsheledMeteringOptions = m.Spec.Options
			Expect(unmarsheledMeteringOptions.ID).Should(MatchRegexp("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"), "Should be a valid guid")
			Expect(unmarsheledMeteringOptions.Timestamp).Should(MatchRegexp(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}$`), "The tiemstamp format should match")
			Expect(unmarsheledMeteringOptions.ServiceInfo.ID).To(Equal(opt.ServiceID), "Service Id should be populated")
			Expect(unmarsheledMeteringOptions.ServiceInfo.Plan).To(Equal(opt.PlanID))
			Expect(unmarsheledMeteringOptions.ConsumerInfo.Environment).To(Equal(""), "The Environment should be populated")
			Expect(unmarsheledMeteringOptions.ConsumerInfo.Region).To(Equal(""))
			Expect(unmarsheledMeteringOptions.ConsumerInfo.Org).To(Equal(opt.Context.OrganizationGUID))
			Expect(unmarsheledMeteringOptions.ConsumerInfo.Space).To(Equal(opt.Context.SpaceGUID))
			Expect(unmarsheledMeteringOptions.ConsumerInfo.Instance).To(Equal(crd.Name))
			Expect(unmarsheledMeteringOptions.InstancesMeasures[0].ID).To(Equal("instances"))
			Expect(unmarsheledMeteringOptions.InstancesMeasures[0].Value).To(Equal(c.MeterStop))
		})
	})
})
