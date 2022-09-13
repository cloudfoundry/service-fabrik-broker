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

package sfplanoffboarding

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/api/errors"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
)

// SFPlanOffboarding protects SFPlan from accidental deletion
type SFPlanOffboarding struct {
	client.Client
	Log logr.Logger
}

// Reconcile reads that state of the SFPlan object and makes changes based on the state read
// and what is in the SFPlan.Spec
// Automatically generate RBAC rules to allow the Controller to read and write Deployments
func (r *SFPlanOffboarding) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("sfplan", req.NamespacedName)

	// Fetch the SFPlan instance
	plan := &osbv1alpha1.SFPlan{}
	err := r.Get(ctx, req.NamespacedName, plan)
	if err != nil {
		if errors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	updateRequired := false
	if !plan.GetDeletionTimestamp().IsZero() {
		var instances osbv1alpha1.SFServiceInstanceList
		err = r.List(context.Background(), &instances, client.MatchingLabels{"plan_id": plan.GetName()})
		if err != nil {
			log.Error(err, "Failed to fetch sfserviceinstances for the plan")
			return ctrl.Result{}, err
		}
		log.Info("instance", "size", len(instances.Items))
		if len(instances.Items) <= 0 || r.canBeDeleted(&instances, plan.GetName()) {
			log.Info("Reconcile: ", "Removing finalizer ", plan.GetDeletionTimestamp().IsZero())
			controllerutil.RemoveFinalizer(plan, constants.FinalizerName)
			updateRequired = true
		} else {
			log.Info("Not deleting the plan since one or more sfserviceinstances exist for this plan, that are not set to be deleted")
		}
	}

	err = r.reconcileFinalizers(plan, 0, updateRequired)
	if err != nil {
		if errors.IsNotFound(err) {
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err
	}
	return ctrl.Result{}, nil
}

func (r *SFPlanOffboarding) canBeDeleted(instances *osbv1alpha1.SFServiceInstanceList, planID string) bool {
	for _, instance := range instances.Items {
		if instance.GetDeletionTimestamp().IsZero() {
			return false
		}
	}
	return true
}

func (r *SFPlanOffboarding) reconcileFinalizers(plan *osbv1alpha1.SFPlan, retryCount int, updateRequired bool) error {
	ctx := context.Background()
	planID := plan.GetName()
	log := r.Log.WithValues("planID", planID)

	if plan.GetDeletionTimestamp().IsZero() {
		if !utils.ContainsString(plan.GetFinalizers(), constants.FinalizerName) {
			// The plan is not being deleted, so if it does not have our finalizer,
			// then lets add the finalizer and update the plan.
			controllerutil.AddFinalizer(plan, constants.FinalizerName)
			updateRequired = true
		}
	}
	if !updateRequired {
		log.Info("Update of the plan is not required... returning")
		return nil
	}
	if err := r.Update(ctx, plan); err != nil {
		if retryCount < constants.ErrorThreshold {
			log.Info("Retrying", "function", "reconcileFinalizers", "retryCount", retryCount+1)
			return r.reconcileFinalizers(plan, retryCount+1, updateRequired)
		}
		return err
	}
	return nil
}

// SetupWithManager registers the SFPlan Controller
func (r *SFPlanOffboarding) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&osbv1alpha1.SFPlan{}).
		Named("mcd_sfplan_offboarding").
		WithEventFilter(watches.NamespaceFilter()).
		Complete(r)
}
