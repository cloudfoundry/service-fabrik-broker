// +build multiclusterdeploy

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

package multiclusterdeploy

import (
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/provisioner"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/sfclusterreplicator"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/sfservicebindingreplicator"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/sfserviceinstancereplicator"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/sfservicesreplicator"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/watchmanager"

	ctrl "sigs.k8s.io/controller-runtime"
)

// SetupWithManager registers the multiclusterdeploy with the manager
func SetupWithManager(mgr ctrl.Manager) error {
	var err error
	setupLog := ctrl.Log.WithName("setup").WithName("multiclusterdeploy")

	// Init watch manager
	err = watchmanager.Initialize(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		setupLog.Error(err, "unable to Initialize watchmanager")
		return err
	}

	if err = (&provisioner.ReconcileProvisioner{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("mcd").WithName("provisioner"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create provisioner", "controller", "ReconcileProvisioner")
		return err
	}

	if err = (&sfservicebindingreplicator.BindingReplicator{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("mcd").WithName("replicator").WithName("binding"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create binding replicator", "controller", "BindingReplicator")
		return err
	}

	if err = (&sfserviceinstancereplicator.InstanceReplicator{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("mcd").WithName("replicator").WithName("instance"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create instance replicator", "controller", "InstanceReplicator")
		return err
	}

	if err = (&sfservicesreplicator.ReconcileSFServices{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("mcd").WithName("replicator").WithName("service"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create service replicator", "controller", "ReconcileSFServices")
		return err
	}

	if err = (&sfclusterreplicator.SFClusterReplicator{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("mcd").WithName("replicator").WithName("cluster"),
		Scheme: mgr.GetScheme(),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create cluster replicator", "controller", "SFClusterReplicator")
		return err
	}

	return nil
}
