//go:build schedulers
// +build schedulers

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

package schedulers

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/schedulers/sflabelselectorscheduler"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/schedulers/sfserviceinstancecounter"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/schedulers/sfserviceinstanceupdater"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// SetupWithManager registers the schedulers with the manager
func SetupWithManager(mgr ctrl.Manager) error {
	var err error
	setupLog := ctrl.Log.WithName("setup").WithName("schedulers")

	go updateInstanceCount(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())

	if err = (&sfserviceinstancecounter.SFServiceInstanceCounter{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("scheduler-helper").WithName("sfserviceinstance-counter"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create sfserviceinstance-counter", "scheduler-helper", "SFServiceInstanceCounter")
		return err
	}

	_ = mgr.GetFieldIndexer().IndexField(context.Background(), &osbv1alpha1.SFServiceInstance{}, "spec.planId", func(o client.Object) []string {
		planID := o.(*osbv1alpha1.SFServiceInstance).Spec.PlanID
		return []string{planID}
	})

	if err = (&sfserviceinstanceupdater.SFServiceInstanceUpdater{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("scheduler-helper").WithName("sfserviceinstance-updater"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create sfserviceinstance-updater", "scheduler-helper", "SFServiceInstanceUpdater")
		return err
	}

	if err = (&sflabelselectorscheduler.SFLabelSelectorScheduler{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("schedulers").WithName("labelselector"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create scheduler", "scheduler", "SFLabelSelectorScheduler")
		return err
	}

	return nil
}
