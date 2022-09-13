//go:build multiclusterdeploy
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
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/offboarding"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/provisioner"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/sfclusterreplicator"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/sfplanoffboarding"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/sfservicebindingreplicator"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/sfserviceinstancereplicator"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/watchmanager"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// SetupWithManager registers the multiclusterdeploy with the manager
func SetupWithManager(mgr ctrl.Manager) error {
	var err error
	setupLog := ctrl.Log.WithName("setup").WithName("multiclusterdeploy")

	if err = upgradeHook(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper()); err != nil {
		setupLog.Error(err, "unable to run upgradeHook")
		// Not failing even if upgrade hook fails
	}

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

	if err = (&sfclusterreplicator.SFClusterReplicator{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("mcd").WithName("replicator").WithName("cluster"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create cluster replicator", "controller", "SFClusterReplicator")
		return err
	}

	if err = (&offboarding.SFClusterOffboarding{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("mcd").WithName("offboarding").WithName("cluster"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create cluster offboarding controller", "controller", "SFClusterOffboarding")
		return err
	}

	if err = (&sfplanoffboarding.SFPlanOffboarding{
		Client: mgr.GetClient(),
		Log:    ctrl.Log.WithName("mcd").WithName("sfplan_offboarding").WithName("sfplan"),
	}).SetupWithManager(mgr); err != nil {
		setupLog.Error(err, "unable to create sfplan offboarding controller", "controller", "SFPlanOffboarding")
		return err
	}

	_ = mgr.GetFieldIndexer().IndexField(context.Background(), &osbv1alpha1.SFServiceInstance{}, "spec.clusterId", func(o client.Object) []string {
		clusterID := o.(*osbv1alpha1.SFServiceInstance).Spec.ClusterID
		return []string{clusterID}
	})

	_ = mgr.GetFieldIndexer().IndexField(context.Background(), &osbv1alpha1.SFServiceInstance{}, "status.state", func(o client.Object) []string {
		instanceState := o.(*osbv1alpha1.SFServiceInstance).Status.State
		return []string{instanceState}
	})

	_ = mgr.GetFieldIndexer().IndexField(context.Background(), &osbv1alpha1.SFServiceBinding{}, "status.state", func(o client.Object) []string {
		bindingState := o.(*osbv1alpha1.SFServiceBinding).Status.State
		return []string{bindingState}
	})

	return nil
}
