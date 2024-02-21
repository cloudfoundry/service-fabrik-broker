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

package sfserviceinstanceupdater

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"
	"github.com/go-logr/logr"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
)

// SFServiceInstanceUpdater reconciles a SFServiceInstance object
type SFServiceInstanceUpdater struct {
	client.Client
	Log logr.Logger
}

// Reconcile triggers updation of the SFServiceInstances for changes in
// SFPlan.spec. It filters out already updated SFServiceInstance by matching the
// planhash stored in the annotation of the SFServiceInstance.
//
// After triggering update on all the selected SFServiceInstance, the
// SFPlan.Status.SpecHash is upated with the new checksum of SFPlan.spec.
// If update failed for any of the SFServiceInstance, the SFPlan.Status.SpecHash
// is not updated. Thus failure can be identified by the difference in SFPlan.annotations.planhash
// and SFPlan.Status.SpecHash. The failed ones are reconciled again after some time.
func (r *SFServiceInstanceUpdater) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("sfserviceinstance-updater", req.NamespacedName)

	plan := &osbv1alpha1.SFPlan{}
	err := r.Get(ctx, req.NamespacedName, plan)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			log.Error(err, "Error occured while getting the sfplan")
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err
	}

	if plan.Spec.AutoUpdateInstances {
		currentSpecHash := utils.CalculateHash(plan.Spec)
		if plan.Status.SpecHash == "" {
			err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
				err1 := r.Get(ctx, req.NamespacedName, plan)
				if err1 != nil {
					log.Error(err, "Error occured while fetching the sfplan")
					return err1
				}
				currentSpecHash := utils.CalculateHash(plan.Spec)
				plan.Status.SpecHash = currentSpecHash
				return r.Status().Update(ctx, plan)
			})
			if err != nil {
				log.Error(err, "Error occured while updating the sfplan spec-hash", "cluster-name", plan.GetName(), "current-hash", currentSpecHash)
				return ctrl.Result{}, err
			}
		} else if plan.Status.SpecHash != currentSpecHash {
			updateStatusSpecHash, err := r.updateServiceInstances(ctx, plan.ObjectMeta.Name, currentSpecHash)
			if err != nil {
				log.Error(err, "Error while triggering update from serviceinstance")
				updateStatusSpecHash = false
				return ctrl.Result{}, err
			}

			if updateStatusSpecHash { // update plan only when all instances are updated
				err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
					err1 := r.Get(ctx, req.NamespacedName, plan)
					if err1 != nil {
						log.Error(err, "Error occured while fetching the sfplan")
						return err1
					}
					plan.Status.SpecHash = utils.CalculateHash(plan.Spec)
					return r.Status().Update(ctx, plan)
				})
				if err != nil {
					log.Error(err, "Error occured while updating the sfplan spec-hash", "cluster-name", plan.GetName(), "current-hash", currentSpecHash)
					return ctrl.Result{}, err
				}
			}
		}
	}
	return ctrl.Result{}, nil
}

// Keeping the plan hash for versioning
func (r *SFServiceInstanceUpdater) updateServiceInstances(ctx context.Context, planID string, currentSpecHash string) (bool, error) {
	log := r.Log.WithValues("planID", planID)

	updateStatusSpecHash := true
	sfserviceinstances := &osbv1alpha1.SFServiceInstanceList{}
	instanceOptions := &client.ListOptions{}
	client.MatchingFields{"spec.planId": planID}.ApplyToList(instanceOptions)
	log.Info("spec.planId", "spec.planId", planID)

	for more := true; more; more = (sfserviceinstances.Continue != "") {
		err := r.List(ctx, sfserviceinstances, instanceOptions, client.Limit(constants.ListPaginationLimit),
			client.Continue(sfserviceinstances.Continue))
		if err != nil {
			log.Error(err, "error while fetching sfserviceinstances")
			return updateStatusSpecHash, err
		}

		log.Info("Instance count", "size", len(sfserviceinstances.Items))

		for _, instance := range sfserviceinstances.Items {
			labels := instance.GetLabels()
			lastOperation := labels[constants.LastOperationKey]

			annotations := instance.GetAnnotations()
			planHash := annotations[constants.PlanHashKey]

			if lastOperation == "delete" || planHash == currentSpecHash {
				// Skip updating instance in deletion
				// or already updated
				log.Info("Update not required : Instance with plan ID", "planID", planID, "serviceInstanceID", instance.Name, "lastOperation", lastOperation)
				continue
			}

			log.Info("Update required for : Instance with plan ID", "planID", planID, "serviceInstanceID", instance.Name)
			// Set state as update for instances
			err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
				err1 := r.Get(ctx, types.NamespacedName{
					Name:      instance.GetName(),
					Namespace: instance.GetNamespace(),
				}, &instance)
				if err1 != nil {
					return err1
				}
				instance.Status.State = "update"
				return r.Update(ctx, &instance)
			})
			if err != nil {
				log.Error(err, "Error occured while auto updating the instance", "instance-name", instance.GetName())
				// There is an error while updating an instance
				// block updating status.spec.hash in plan to ensure retry
				updateStatusSpecHash = false
			}
		}
	}
	return updateStatusSpecHash, nil
}

// SetupWithManager should be called if the controller is to be initialized.
func (r *SFServiceInstanceUpdater) SetupWithManager(mgr ctrl.Manager) error {
	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()

	return ctrl.NewControllerManagedBy(mgr).
		Named("scheduler_helper_sfserviceinstance_updater").
		WithOptions(controller.Options{
			MaxConcurrentReconciles: interoperatorCfg.InstanceWorkerCount,
		}).
		For(&osbv1alpha1.SFPlan{}).
		WithEventFilter(watches.SfServiceInstanceUpdateFilter()).
		Complete(r)
}
