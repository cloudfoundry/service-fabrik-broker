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

package sfdefaultscheduler

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// SFDefaultScheduler schedules an SFServiceInstance to the default cluster
type SFDefaultScheduler struct {
	client.Client
	Log    logr.Logger
	scheme *runtime.Scheme
}

// Reconcile schedules the SFServiceInstance to the default SFCluster and sets the
// ClusterID in SFServiceInstance.Spec.ClusterID.
func (r *SFDefaultScheduler) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("sfserviceinstance", req.NamespacedName)

	// Fetch the SFDefaultScheduler instance
	instance := &osbv1alpha1.SFServiceInstance{}
	err := r.Get(ctx, req.NamespacedName, instance)
	if err != nil {
		if errors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}
	if instance.Spec.ClusterID == "" {
		instance.Spec.ClusterID = constants.OwnClusterID
		if err := r.Update(context.Background(), instance); err != nil {
			log.Error(err, "failed to set cluster id")
			return ctrl.Result{}, err
		}
	}
	return ctrl.Result{}, nil
}

// SetupWithManager registers the default scheduler with manager
// add setups the watches.
func (r *SFDefaultScheduler) SetupWithManager(mgr ctrl.Manager) error {
	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()

	if interoperatorCfg.SchedulerType != constants.DefaultSchedulerType {
		return nil
	}

	r.scheme = mgr.GetScheme()

	return ctrl.NewControllerManagedBy(mgr).
		Named("scheduler_default").
		For(&osbv1alpha1.SFServiceInstance{}).
		WithEventFilter(watches.NamespaceLabelFilter()).
		Complete(r)
}
