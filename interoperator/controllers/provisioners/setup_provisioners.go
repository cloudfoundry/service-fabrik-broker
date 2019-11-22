// +build provisioners default

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

package provisioners

import (
	"os"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/provisioners/sfplan"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/provisioners/sfservice"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/provisioners/sfservicebinding"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/provisioners/sfservicebindingcleaner"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/provisioners/sfserviceinstance"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	ctrl "sigs.k8s.io/controller-runtime"
)

// SetupWithManager registers the provisioners with the manager
func SetupWithManager(mgr ctrl.Manager) error {
	var err error
	setupLog := ctrl.Log.WithName("setup").WithName("provisioners")

	// Init watch list
	setupLog.Info("Initializing interoperator watch list")
	if _, err := watches.InitWatchConfig(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper()); err != nil {
		setupLog.Error(err, "unable initializing interoperator watch list")
		os.Exit(1)
	}

	if err = (&sfservice.ReconcileSFService{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("provisioners").WithName("service"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create provisioner", "controller", "ReconcileSFService")
		return err
	}

	if err = (&sfplan.ReconcileSFPlan{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("provisioners").WithName("plan"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create provisioner", "controller", "ReconcileSFPlan")
		return err
	}

	if err = (&sfserviceinstance.ReconcileSFServiceInstance{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("provisioners").WithName("instance"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create provisioner", "controller", "ReconcileSFServiceInstance")
		return err
	}

	if err = (&sfservicebinding.ReconcileSFServiceBinding{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("provisioners").WithName("binding"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create provisioner", "controller", "ReconcileSFServiceBinding")
		return err
	}

	if err = (&sfservicebindingcleaner.ReconcileSFServiceBindingCleaner{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("provisioners").WithName("bindingcleaner"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create provisioner", "controller", "SfServiceBindingCleanerReconciler")
		return err
	}

	return nil
}
