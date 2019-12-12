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

package sfserviceinstancecounter

import (
	"context"
	"os"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/go-logr/logr"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
)

// SFServiceInstanceCounter reconciles a SFServiceInstance object
type SFServiceInstanceCounter struct {
	client.Client
	Log             logr.Logger
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile schedules the SFServiceInstance to one SFCluster and sets the ClusterID in
// SFServiceInstance.Spec.ClusterID. It chooses the destination cluster based on clusterSelector
// template provided in the plan.
func (r *SFServiceInstanceCounter) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("sfserviceinstance-counter", req.NamespacedName)

	instance := &osbv1alpha1.SFServiceInstance{}
	err := r.Get(ctx, req.NamespacedName, instance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err
	}

	if instance.Spec.ClusterID != "" { //act only if the clusterID is not set
		log.Info("ClusterID is set", "function", "Reconcile", "ClusterID", instance.Spec.ClusterID)
		if instance.GetDeletionTimestamp().IsZero() { // not marked for deletion
			if !utils.ContainsString(instance.GetFinalizers(), constants.SFServiceInstanceCounterFinalizerName) {
				log.Info("Finalizer not yet set", "function", "Reconcile", "Finalizer", constants.SFServiceInstanceCounterFinalizerName)
				//add the finalizer and count ++
				err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
					instance.SetFinalizers(append(instance.GetFinalizers(), constants.SFServiceInstanceCounterFinalizerName))
					if err1 := r.Update(ctx, instance); err1 != nil {
						_ = r.Get(ctx, req.NamespacedName, instance)
						return err1
					}
					return nil
				})
				if err != nil {
					return ctrl.Result{}, err
				}

				sfNamespace := os.Getenv(constants.NamespaceEnvKey)
				if sfNamespace == "" {
					sfNamespace = constants.DefaultServiceFabrikNamespace
				}
				sfCluster := &resourcev1alpha1.SFCluster{}
				namespacedName := types.NamespacedName{
					Name:      instance.Spec.ClusterID,
					Namespace: sfNamespace,
				}
				err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
					err1 := r.Get(ctx, namespacedName, sfCluster)
					if err1 != nil {
						return err1
					}
					currentCount := sfCluster.Status.ServiceInstanceCount
					sfCluster.Status.ServiceInstanceCount = currentCount + 1
					return r.Status().Update(ctx, sfCluster)
				})
				if err != nil {
					log.Error(err, "Error occured while increasing the service instance count", "cluster-name", sfCluster.GetName(), "current-count", sfCluster.Status.ServiceInstanceCount)
					return ctrl.Result{}, err
				}
				log.Info("Cluster labeling complete", "cluster name", sfCluster.GetName(), "cluster size", sfCluster.Status.ServiceInstanceCount)
			}
		} else {
			if utils.ContainsString(instance.GetFinalizers(), constants.SFServiceInstanceCounterFinalizerName) && !utils.ContainsString(instance.GetFinalizers(), constants.FinalizerName) {
				//remove the finalizer and count --
				err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
					instance.SetFinalizers(utils.RemoveString(instance.GetFinalizers(), constants.SFServiceInstanceCounterFinalizerName))
					if err1 := r.Update(ctx, instance); err1 != nil {
						_ = r.Get(ctx, req.NamespacedName, instance)
						return err1
					}
					return nil
				})
				if err != nil {
					return ctrl.Result{}, err
				}

				sfNamespace := os.Getenv(constants.NamespaceEnvKey)
				if sfNamespace == "" {
					sfNamespace = constants.DefaultServiceFabrikNamespace
				}
				sfCluster := &resourcev1alpha1.SFCluster{}
				namespacedName := types.NamespacedName{
					Name:      instance.Spec.ClusterID,
					Namespace: sfNamespace,
				}
				err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
					err1 := r.Get(ctx, namespacedName, sfCluster)
					if err1 != nil {
						return err1
					}
					currentCount := sfCluster.Status.ServiceInstanceCount
					sfCluster.Status.ServiceInstanceCount = currentCount - 1
					return r.Status().Update(ctx, sfCluster)
				})
				if err != nil {
					return ctrl.Result{}, err
				}
			}
		}
	}

	return ctrl.Result{}, nil
}

// SetupWithManager registers the least utilized scheduler with manager
// and setups the watches.
func (r *SFServiceInstanceCounter) SetupWithManager(mgr ctrl.Manager) error {
	clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	r.clusterRegistry = clusterRegistry

	r.scheme = mgr.GetScheme()

	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()

	return ctrl.NewControllerManagedBy(mgr).
		Named("scheduler_helper_sfserviceinstance_counter").
		WithOptions(controller.Options{
			MaxConcurrentReconciles: interoperatorCfg.InstanceWorkerCount,
		}).
		For(&osbv1alpha1.SFServiceInstance{}).
		Complete(r)
}
