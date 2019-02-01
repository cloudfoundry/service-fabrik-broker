package metering

import (
	// "encoding/json"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/apis/instance/v1alpha1"
	c "github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/webhooks/manager/resources"
	. "github.com/onsi/ginkgo"
	. "github.com/onsi/gomega"
)

var _ = Describe("Sfevent", func() {
	Describe("NewMetering", func() {
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
			m := NewMetering(opt, crd, signal, c.UpdateEvent)
			var unmarsheledSfeventOptions v1alpha1.SfeventOptions
			unmarsheledSfeventOptions = m.Spec.Options
			Expect(unmarsheledSfeventOptions.ID).Should(MatchRegexp("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"), "Should be a valid guid")
			Expect(unmarsheledSfeventOptions.Timestamp).Should(MatchRegexp(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}$`), "The tiemstamp format should match")
			Expect(unmarsheledSfeventOptions.ServiceInfo.ID).To(Equal(opt.ServiceID), "Service Id should be populated")
			Expect(unmarsheledSfeventOptions.ServiceInfo.Plan).To(Equal(opt.PlanID))
			Expect(unmarsheledSfeventOptions.ConsumerInfo.Environment).To(Equal(""), "The Environment should be populated")
			Expect(unmarsheledSfeventOptions.ConsumerInfo.Region).To(Equal(""))
			Expect(unmarsheledSfeventOptions.ConsumerInfo.Org).To(Equal(opt.Context.OrganizationGUID))
			Expect(unmarsheledSfeventOptions.ConsumerInfo.Space).To(Equal(opt.Context.SpaceGUID))
			Expect(unmarsheledSfeventOptions.ConsumerInfo.Instance).To(Equal(crd.Name))
			Expect(unmarsheledSfeventOptions.InstancesMeasures[0].ID).To(Equal("instances"))
			Expect(unmarsheledSfeventOptions.InstancesMeasures[0].Value).To(Equal(c.MeterStop))
		})
	})
})
