package services

import (
	"context"
	"fmt"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"k8s.io/apimachinery/pkg/api/errors"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
)

// FindServiceInfo fetches the details of a service
// from the services path
func FindServiceInfo(client kubernetes.Client, serviceID string, planID string) (*osbv1alpha1.Service, *osbv1alpha1.Plan, error) {
	services := &osbv1alpha1.ServiceList{}
	labels := make(map[string]string)
	labels["serviceId"] = serviceID
	options := kubernetes.MatchingLabels(labels)

	err := client.List(context.TODO(), options, services)
	if err != nil {
		if errors.IsNotFound(err) {
			return nil, nil, fmt.Errorf("unable to find service with id %s", serviceID)
		}
		return nil, nil, err
	}
	var service *osbv1alpha1.Service
	for _, obj := range services.Items {
		if obj.Spec.ID == serviceID {
			service = &obj
		}
	}
	if service == nil {
		return nil, nil, fmt.Errorf("unable to find service with id %s", serviceID)
	}

	plans := &osbv1alpha1.PlanList{}
	labels = make(map[string]string)
	labels["serviceId"] = serviceID
	labels["planId"] = planID
	options = kubernetes.MatchingLabels(labels)

	err = client.List(context.TODO(), options, plans)
	if err != nil {
		if errors.IsNotFound(err) {
			return nil, nil, fmt.Errorf("unable to find plan with service id %s and plan id %s", serviceID, planID)
		}
		return nil, nil, err
	}

	for _, plan := range plans.Items {
		if plan.Spec.ID == planID {
			return service, &plan, nil
		}
	}
	return nil, nil, fmt.Errorf("unable to find plan with service id %s and plan id %s", serviceID, planID)
}
