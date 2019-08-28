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

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/prometheus/common/log"

	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

//var log = logf.Log.WithName("binding.replicator")

/**
* USER ACTION REQUIRED: This is a scaffold file intended for the user to modify with their own Controller
* business logic.  Delete these comments after modifying this file.*
 */

// Add creates a new SFServiceInstanceReplicator Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
func Add(mgr manager.Manager) error {
	clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	return add(mgr, newReconciler(mgr, clusterRegistry))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager, clusterRegistry registry.ClusterRegistry) reconcile.Reconciler {
	return &ReconcileSFServiceBindingReplicator{
		Client:          mgr.GetClient(),
		scheme:          mgr.GetScheme(),
		clusterRegistry: clusterRegistry,
	}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	// Create a new controller
	c, err := controller.New("sfservicebindingreplicator-controller", mgr, controller.Options{Reconciler: r})
	if err != nil {
		return err
	}

	// Watch for changes to SFServiceInstanceReplicator
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.SFServiceBinding{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileSFServiceBindingReplicator{}

// ReconcileSFServiceBindingReplicator reconciles a ReconcileSFServiceBindingReplicator object
type ReconcileSFServiceBindingReplicator struct {
	client.Client
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile reads that state of the cluster for a SFServiceInstanceReplicator object and makes changes based on the state read
// and what is in the SFServiceInstanceReplicator.Spec
// TODO(user): Modify this Reconcile function to implement your Controller logic.  The scaffolding writes
// a Deployment as an example
// +kubebuilder:rbac:groups=osb.servicefabrik.io,resources=*,verbs=*
func (r *ReconcileSFServiceBindingReplicator) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the SFServiceInstanceReplicator instance
	binding := &osbv1alpha1.SFServiceBinding{}
	replica := &osbv1alpha1.SFServiceBinding{}
	err := r.Get(context.TODO(), request.NamespacedName, binding)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return reconcile.Result{}, err
	}

	bindingID := binding.GetName()
	state := binding.GetState()
	/*
		clusterID, err := binding.GetClusterID(r)
		if err != nil {
			log.Info("clusterID not set. Ignoring", "instance", bindingID)
			return reconcile.Result{}, nil
		}
	*/
	clusterID := "2"
	if clusterID == constants.MasterClusterID {
		// Target cluster is mastercluster itself
		// Replication not needed
		log.Info("Target cluster is master cluster itself, replication not needed..")
		return reconcile.Result{}, nil
	}

	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		return reconcile.Result{}, err
	}

	if state == "delete" && !binding.GetDeletionTimestamp().IsZero() {
		replica.SetName(binding.GetName())
		replica.SetNamespace(binding.GetNamespace())
		err := targetClient.Delete(context.TODO(), replica)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				log.Info("Seems like replica is already deleted from sister cluster.. ignoring delete failure.")
			} else {
				return reconcile.Result{}, err
			}
		}
	}

	if state == "in_queue" || state == "delete" {
		log.Info("Trying to get binding ", bindingID, " from cluster", clusterID)
		err = targetClient.Get(context.TODO(), types.NamespacedName{
			Name:      binding.GetName(),
			Namespace: binding.GetNamespace(),
		}, replica)
		if err != nil {
			if apiErrors.IsNotFound(err) && state != "delete" {
				replicateSFServiceBindingResourceData(binding, replica)
				err = targetClient.Create(context.TODO(), replica)
				if err != nil {
					log.Error(err, "Error occurred while creating SFServiceBinding to cluster ",
						"clusterID", clusterID, "bindingID", bindingID, "state", state)
					return reconcile.Result{}, err
				}
			} else {
				log.Error(err, "Error occurred while getting SFServiceBinding from cluster ",
					"clusterID", clusterID, "bindingID", bindingID, "state", state)
				return reconcile.Result{}, err
			}
		} else {
			replicateSFServiceBindingResourceData(binding, replica)
			err = targetClient.Update(context.TODO(), replica)
			if err != nil {
				log.Error(err, "Error occurred while updating SFServiceBinding to cluster ",
					"clusterID", clusterID, "bindingID", bindingID, "state", state)
				return reconcile.Result{}, err
			}
		}

		err = r.setInProgress(binding, 0)
		if err != nil {
			return reconcile.Result{}, err
		}
	}

	state = binding.GetState()

	//TODO: change it to in progress
	if state == "in_progress" {
		replicaLabels := make(map[string]string)
		var replicaState, replicaLastOperation string
		err = targetClient.Get(context.TODO(), request.NamespacedName, replica)
		if err != nil {
			if apiErrors.IsNotFound(err) && !binding.GetDeletionTimestamp().IsZero() {
				//current operation is unbind and it must have been succeeded on sister cluster
				binding.SetState("succeeded")
				replicaState = "succeeded"
				replicaLabels[constants.LastOperationKey] = "delete"
			} else {
				log.Error(err, "Failed to fetch SFServiceBinding from target cluster", "binding ", bindingID,
					"clusterID ", clusterID, "state ", state)
				// Error reading the object - requeue the request.
				return reconcile.Result{}, err
			}
		} else if replica.GetState() == "in_queue" || replica.GetState() == "delete" {
			return reconcile.Result{}, nil
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
				secretName := replica.Status.Response.SecretRef
				if secretName == "" {
					secretName = "sf-" + binding.GetName()
				}
				bindingSecret := &corev1.Secret{}
				bindingSecret.SetName(secretName)
				bindingSecret.SetNamespace(binding.GetNamespace())
				err = r.Delete(context.TODO(), bindingSecret)
				if err != nil {
					log.Error(err, "Failed to delete secret in master cluster", "binding", bindingID,
						"clusterID ", clusterID, "state ", state)
					// Error deleting the object - requeue the request.
					return reconcile.Result{}, err
				}
			} else {
				replicaSecret := &corev1.Secret{}
				secretName := replica.Status.Response.SecretRef
				if secretName == "" {
					secretName = "sf-" + binding.GetName()
				}
				err = targetClient.Get(context.TODO(), types.NamespacedName{
					Name:      secretName,
					Namespace: replica.GetNamespace(),
				}, replicaSecret)
				if err != nil {
					log.Error(err, "Failed to get secret from sister cluster", "binding", bindingID,
						"clusterID ", clusterID, "state ", state)
					return reconcile.Result{}, err
				}
				bindingSecret := &corev1.Secret{}
				bindingSecret.Data = make(map[string][]byte)
				bindingSecret.SetName(replicaSecret.GetName())
				bindingSecret.SetNamespace(replicaSecret.GetNamespace())
				for k, v := range replicaSecret.Data {
					bindingSecret.Data[k] = v
				}
				if err = controllerutil.SetControllerReference(binding, bindingSecret, r.scheme); err != nil {
					log.Error(err, "failed to set owner reference for secret", "binding", bindingID)
					return reconcile.Result{}, err
				}
				err = r.Update(context.TODO(), bindingSecret)
				if err != nil {
					if apiErrors.IsNotFound(err) {
						err = r.Create(context.TODO(), bindingSecret)
						if err != nil {
							log.Error(err, "Error occurred while replicating secret to master cluster ",
								"bindingID ", bindingID, "state", state)
							return reconcile.Result{}, err
						}
					} else {
						log.Error(err, "Error occurred while replicating secret to master cluster ",
							"bindingID ", bindingID, "state", state)
						return reconcile.Result{}, err
					}
				}
			}
		}
		err = r.Update(context.TODO(), binding)
		if err != nil {
			log.Error(err, "Failed to update SFServiceBinding in master cluster", "binding", bindingID,
				"clusterID ", clusterID, "state ", state)
			// Error updating the object - requeue the request.
			return reconcile.Result{}, err
		}
	}

	return reconcile.Result{}, nil
}

func (r *ReconcileSFServiceBindingReplicator) setInProgress(binding *osbv1alpha1.SFServiceBinding, retryCount int) error {
	bindingID := binding.GetName()
	state := binding.GetState()
	binding.SetState("in progress")
	log.Info("Trying to update binding ", bindingID, " to state ", binding.GetState())
	err := r.Update(context.TODO(), binding)
	if err != nil {
		if retryCount < constants.ErrorThreshold {
			log.Info("Retrying", "function", "setInProgress", "retryCount", retryCount+1, "objectID", bindingID)
			err := r.Get(context.TODO(), types.NamespacedName{
				Name:      bindingID,
				Namespace: binding.GetNamespace(),
			}, binding)
			if err != nil {
				log.Error(err, "Failed to fetch sfservicebinding for setInProgress", "operation", state,
					"bindingId ", bindingID)
				return err
			}
			return r.setInProgress(binding, retryCount+1)
		}
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
