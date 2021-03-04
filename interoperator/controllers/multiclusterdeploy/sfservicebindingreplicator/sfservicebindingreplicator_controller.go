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

package sfservicebindingreplicator

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/watchmanager"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var getWatchChannel = watchmanager.GetWatchChannel

// BindingReplicator replicates sfserviceinstance
type BindingReplicator struct {
	client.Client
	Log             logr.Logger
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
	cfgManager      config.Config
}

// Reconcile reads that state of the cluster for a SFServiceInstanceReplicator object and makes changes based on the state read
// and what is in the SFServiceInstanceReplicator.Spec
func (r *BindingReplicator) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("binding", req.NamespacedName)

	// Fetch the SFServiceInstanceReplicator instance
	binding := &osbv1alpha1.SFServiceBinding{}
	replica := &osbv1alpha1.SFServiceBinding{}
	err := r.Get(ctx, req.NamespacedName, binding)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	bindingID := binding.GetName()
	state := binding.GetState()

	clusterID, err := binding.GetClusterID(r)
	if err != nil {
		log.Info("clusterID not set. Ignoring", "instance", bindingID)
		return ctrl.Result{}, nil
	}

	// Fetch current primary cluster id from configmap
	interoperatorCfg := r.cfgManager.GetConfig()
	currPrimaryClusterID := interoperatorCfg.PrimaryClusterID

	if clusterID == currPrimaryClusterID {
		// Target cluster is mastercluster itself
		// Replication not needed
		log.Info("Target cluster is master cluster itself, replication not needed..")
		return ctrl.Result{}, nil
	}
	log.Info("Binding replication started for sister cluster:", "bindinID", bindingID, "clusterID", clusterID)

	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		return ctrl.Result{}, err
	}

	if state == "delete" && !binding.GetDeletionTimestamp().IsZero() {
		replica.SetName(binding.GetName())
		replica.SetNamespace(binding.GetNamespace())
		err := targetClient.Delete(ctx, replica)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				log.Error(err, "Seems like replica is already deleted from sister cluster.. ignoring delete failure.", "bindinID", bindingID, "clusterID", clusterID)
			} else {
				log.Error(err, "Could not delete replica from sister cluster for unbind..aborting", "bindinID", bindingID, "clusterID", clusterID)
				return ctrl.Result{}, err
			}
		}
	}

	if state == "in_queue" || state == "delete" {
		log.Info("Trying to get binding from sister cluster.. ", "bindinID", bindingID, "clusterID", clusterID, "state", state)
		err = targetClient.Get(ctx, types.NamespacedName{
			Name:      binding.GetName(),
			Namespace: binding.GetNamespace(),
		}, replica)
		if err != nil {
			if apiErrors.IsNotFound(err) && state != "delete" {
				replicateSFServiceBindingResourceData(binding, replica)
				err = targetClient.Create(ctx, replica)
				if err != nil {
					log.Error(err, "Error occurred while creating SFServiceBinding to cluster ",
						"clusterID", clusterID, "bindingID", bindingID, "state", state)
					return ctrl.Result{}, err
				}
			} else if apiErrors.IsNotFound(err) && state == "delete" {
				log.Error(err, "binding id not found on sister cluster for processing delete .. proceeding with deleting binding on master also..",
					"clusterID", clusterID, "bindingID", bindingID, "state", state)
			} else {
				log.Error(err, "Error occurred while getting SFServiceBinding from cluster ",
					"clusterID", clusterID, "bindingID", bindingID, "state", state)
				return ctrl.Result{}, err
			}
		} else {
			replicateSFServiceBindingResourceData(binding, replica)
			err = targetClient.Update(ctx, replica)
			if err != nil {
				log.Error(err, "Error occurred while updating SFServiceBinding to cluster ",
					"clusterID", clusterID, "bindingID", bindingID, "state", state)
				return ctrl.Result{}, err
			}
		}

		err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
			return r.setInProgress(binding)
		})
		if err != nil {
			log.Error(err, "Error occurred while setting SFServiceBinding to in progress on master cluster ",
				"bindingID", bindingID, "state", state)
			return ctrl.Result{}, err
		}
	}

	state = binding.GetState()

	//TODO: change it to in progress
	if state == "in progress" {
		replicaLabels := make(map[string]string)
		var replicaState, replicaLastOperation string
		log.Info("Trying to obtain binding replica from sister cluster",
			"clusterID", clusterID, "bindingID", bindingID, "state", state)
		err = targetClient.Get(ctx, req.NamespacedName, replica)
		if err != nil {
			if apiErrors.IsNotFound(err) && !binding.GetDeletionTimestamp().IsZero() {
				//current operation is unbind and it must have been succeeded on sister cluster
				log.Info("binding replica not found on sister cluster, but current operation is unbind , so ignoring the failure",
					"clusterID", clusterID, "bindingID", bindingID, "state", state)
				binding.SetState("succeeded")
				replicaState = "succeeded"
				replicaLabels[constants.LastOperationKey] = "delete"
			} else {
				log.Error(err, "Failed to fetch SFServiceBinding from sister cluster", "binding ", bindingID,
					"clusterID ", clusterID, "state ", state)
				// Error reading the object - requeue the request.
				return ctrl.Result{}, err
			}
		} else if replica.GetState() == "in_queue" || replica.GetState() == "delete" {
			log.Info("replica in in_queue or delete state, not replicating it to master cluster",
				"clusterID", clusterID, "bindingID", bindingID, "state", state)
			return ctrl.Result{}, nil
		} else {
			replica.Status.DeepCopyInto(&binding.Status)
			binding.SetLabels(replica.GetLabels())
			binding.SetAnnotations(replica.GetAnnotations())
			replicaLabels = replica.GetLabels()
			replicaState = replica.GetState()
		}
		replicaLastOperation, ok := replicaLabels[constants.LastOperationKey]
		if !ok {
			replicaLastOperation = "in_queue"
		}
		//Replicate the binding secret from right to left if state is succeeded
		if replicaState == "succeeded" {
			if replicaLastOperation == "delete" {
				//delete the secret
				log.Info("unbind on sister cluster completed, deleting secret from master cluster..",
					"clusterID", clusterID, "bindingID", bindingID, "state", state)
				secretName := replica.Status.Response.SecretRef
				if secretName == "" {
					secretName = "sf-" + binding.GetName()
				}
				bindingSecret := &corev1.Secret{}
				bindingSecret.SetName(secretName)
				bindingSecret.SetNamespace(binding.GetNamespace())
				err = r.Delete(ctx, bindingSecret)
				if err != nil {
					if apiErrors.IsNotFound(err) {
						log.Error(err, "Seems like binding secret is already deleted", "bindinID", bindingID)
					} else {
						log.Error(err, "Failed to delete secret in master cluster", "binding", bindingID,
							"clusterID ", clusterID, "state ", state)
						// Error deleting the object - requeue the request.
						return ctrl.Result{}, err
					}
				}
			} else {
				replicaSecret := &corev1.Secret{}
				secretName := replica.Status.Response.SecretRef
				if secretName == "" {
					secretName = "sf-" + binding.GetName()
				}
				err = targetClient.Get(ctx, types.NamespacedName{
					Name:      secretName,
					Namespace: replica.GetNamespace(),
				}, replicaSecret)
				if err != nil {
					log.Error(err, "Failed to get secret from sister cluster", "binding", bindingID,
						"clusterID ", clusterID, "state ", state)
					return ctrl.Result{}, err
				}
				bindingSecret := &corev1.Secret{}
				bindingSecret.Data = make(map[string][]byte)
				bindingSecret.SetName(replicaSecret.GetName())
				bindingSecret.SetNamespace(replicaSecret.GetNamespace())
				for k, v := range replicaSecret.Data {
					bindingSecret.Data[k] = v
				}
				if err = utils.SetOwnerReference(binding, bindingSecret, r.scheme); err != nil {
					log.Error(err, "failed to set owner reference for secret", "binding", bindingID)
					return ctrl.Result{}, err
				}
				log.Info("bind on sister cluster completed, replicating secret to master cluster..",
					"clusterID", clusterID, "bindingID", bindingID, "state", state)
				err = r.Get(ctx, types.NamespacedName{
					Name:      bindingSecret.GetName(),
					Namespace: bindingSecret.GetNamespace(),
				}, bindingSecret)
				if err != nil {
					if apiErrors.IsNotFound(err) {
						err = r.Create(ctx, bindingSecret)
						if err != nil {
							log.Error(err, "Error occurred while replicating secret to master cluster ",
								"bindingID ", bindingID, "state", state)
							return ctrl.Result{}, err
						}
					} else {
						log.Error(err, "Error occurred while replicating secret to master cluster ",
							"bindingID ", bindingID, "state", state)
						return ctrl.Result{}, err
					}
				} else {
					err = r.Update(ctx, bindingSecret)
					if err != nil {
						log.Error(err, "Error occurred while replicating secret to master cluster ",
							"bindingID ", bindingID, "state", state)
						return ctrl.Result{}, err
					}
				}
			}
		}
		err = r.Update(ctx, binding)
		if err != nil {
			log.Error(err, "Failed to update SFServiceBinding in master cluster", "binding", bindingID,
				"clusterID ", clusterID, "state ", state)
			// Error updating the object - requeue the request.
			return ctrl.Result{}, err
		}
	}

	return ctrl.Result{}, nil
}

func (r *BindingReplicator) setInProgress(binding *osbv1alpha1.SFServiceBinding) error {
	bindingID := binding.GetName()
	state := binding.GetState()

	ctx := context.Background()
	log := r.Log.WithValues("bindingID", bindingID)

	err := r.Get(ctx, types.NamespacedName{
		Name:      bindingID,
		Namespace: binding.GetNamespace(),
	}, binding)
	if err != nil {
		log.Error(err, "Failed to fetch sfservicebinding for setInProgress", "operation", state,
			"bindingId ", bindingID)
		return err
	}

	state = binding.GetState()
	binding.SetState("in progress")
	labels := binding.GetLabels()
	if labels == nil {
		labels = make(map[string]string)
	}
	labels[constants.LastOperationKey] = state
	binding.SetLabels(labels)
	log.Info("Trying to update binding ", "bindingID", bindingID, "state", binding.GetState())
	err = r.Update(ctx, binding)
	if err != nil {
		log.Error(err, "Updating status to in progress failed", "operation", state, "bindingId ", bindingID)
		return err
	}
	log.Info("Updated status to in progress ", " operation ", state, " bindingId ", bindingID)
	return nil
}

func replicateSFServiceBindingResourceData(source *osbv1alpha1.SFServiceBinding, dest *osbv1alpha1.SFServiceBinding) {
	dest.SetName(source.GetName())
	dest.SetNamespace(source.GetNamespace())
	dest.SetLabels(source.GetLabels())
	dest.SetAnnotations(source.GetAnnotations())
	source.Spec.DeepCopyInto(&dest.Spec)
	source.Status.DeepCopyInto(&dest.Status)
}

// SetupWithManager registers the MCD Binding replicator with manager
// and setups the watches.
func (r *BindingReplicator) SetupWithManager(mgr ctrl.Manager) error {
	r.scheme = mgr.GetScheme()

	if r.Log == nil {
		r.Log = ctrl.Log.WithName("mcd").WithName("replicator").WithName("binding")
	}
	if r.clusterRegistry == nil {
		clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
		if err != nil {
			return err
		}
		r.clusterRegistry = clusterRegistry
	}

	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	r.cfgManager = cfgManager
	// Watch for changes to SFServiceBinding in sister clusters
	watchEvents, err := getWatchChannel("sfservicebindings")
	if err != nil {
		return err
	}

	builder := ctrl.NewControllerManagedBy(mgr).
		Named("mcd_replicator_binding").
		WithOptions(controller.Options{
			MaxConcurrentReconciles: interoperatorCfg.BindingWorkerCount,
		}).
		For(&osbv1alpha1.SFServiceBinding{}).
		Watches(&source.Channel{Source: watchEvents}, &handler.EnqueueRequestForObject{}).
		WithEventFilter(watches.NamespaceLabelFilter())

	return builder.Complete(r)
}
