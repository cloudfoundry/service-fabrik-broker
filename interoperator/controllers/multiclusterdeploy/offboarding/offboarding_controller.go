/*
Copyright 2019 The Service Fabrik Authors.

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

package offboarding

import (
	"context"
	"strings"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller/controllerutil"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/source"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/utils"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"
)

// The key type is unexported to prevent collisions with context keys defined in
// other packages.
type contextKey string

// logKey is the context key for the logger.
const logKey contextKey = "log"

// SFClusterOffboarding protects SFCluster from accidental deletion
type SFClusterOffboarding struct {
	client.Client
	Log    logr.Logger
	Scheme *runtime.Scheme
}

func (r *SFClusterOffboarding) getLog(ctx context.Context) logr.Logger {
	log, ok := ctx.Value(logKey).(logr.Logger)
	if ok {
		return log
	}
	return r.Log
}

// Reconcile adds finalizers to SFCluster and corresponding secret objects.
// It also sets the owner reference for the secrets as SFCluster
func (r *SFClusterOffboarding) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("sfcluster", req.NamespacedName)
	ctx := context.WithValue(context.Background(), logKey, log)

	// Fetch the SFCluster
	clusterInstance := &resourcev1alpha1.SFCluster{}
	clusterInstance.SetGroupVersionKind(resourcev1alpha1.GroupVersion.WithKind("SFCluster"))
	clusterInstance.SetName(req.NamespacedName.Name)
	clusterInstance.SetNamespace(req.NamespacedName.Namespace)

	mutateFn := func() error {
		// Delete triggered for SFCluster
		if !clusterInstance.GetDeletionTimestamp().IsZero() && clusterInstance.Status.ServiceInstanceCount <= 0 {
			log.Info("Removing finalizer for SFCluster", "ServiceInstanceCount", clusterInstance.Status.ServiceInstanceCount)
			controllerutil.RemoveFinalizer(clusterInstance, constants.InteroperatorFinalizerName)
		}
		return nil
	}
	err := r.reconcileFinalizers(ctx, clusterInstance, mutateFn)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err
	}

	secret := &corev1.Secret{}
	secret.SetGroupVersionKind(corev1.SchemeGroupVersion.WithKind("Secret"))
	secret.SetName(clusterInstance.Spec.SecretRef)
	secret.SetNamespace(clusterInstance.GetNamespace())

	mutateFn = func() error {
		if secret.GetDeletionTimestamp().IsZero() {
			return utils.SetOwnerReference(clusterInstance, secret, r.Scheme)
		} else if clusterInstance.Status.ServiceInstanceCount <= 0 {
			log.Info("Removing finalizer for Secret", "ServiceInstanceCount",
				clusterInstance.Status.ServiceInstanceCount, "secretName", secret.GetName())
			controllerutil.RemoveFinalizer(secret, constants.InteroperatorFinalizerName)
		}
		return nil
	}
	err = r.reconcileFinalizers(ctx, secret, mutateFn)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.
			return ctrl.Result{}, nil
		}
		return ctrl.Result{}, err
	}

	return ctrl.Result{}, nil
}

// reconcileFinalizers handles finalisers for a resource
// If object not found return error
// If deletion timestamp is not set - Adds finaliser
// Executes the MutateFn before applying the changes to api server
func (r *SFClusterOffboarding) reconcileFinalizers(ctx context.Context, obj controllerutil.Object, f controllerutil.MutateFn) error {
	gvk := obj.GetObjectKind().GroupVersionKind()
	gr := schema.GroupResource{
		Group:    gvk.Group,
		Resource: strings.ToLower(gvk.Kind),
	}

	log := r.getLog(ctx).WithValues("kind", gvk.Kind, "name", obj.GetName())
	err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
		mutateFn := func() error {
			if obj.GetDeletionTimestamp().IsZero() {
				controllerutil.AddFinalizer(obj, constants.InteroperatorFinalizerName)
			}
			if obj.GetCreationTimestamp().Time.IsZero() {
				return apiErrors.NewNotFound(gr, obj.GetName())
			}
			if f != nil {
				return f()
			}
			return nil
		}
		operationResult, err := controllerutil.CreateOrUpdate(ctx, r, obj, mutateFn)
		if err != nil {
			return err
		}
		switch operationResult {
		case controllerutil.OperationResultUpdated:
			log.Info("added finalizer")
		case controllerutil.OperationResultCreated:
			err = errors.NewPreconditionError("reconcileFinalizers", "Adding finalizer resulted in creation of resource", nil)
			log.Error(err, "resource got created")
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	return nil
}

// SetupWithManager registers SFClusterOffboarding controller with the manager
func (r *SFClusterOffboarding) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&resourcev1alpha1.SFCluster{}).
		Named("mcd_offboarding").
		Watches(&source.Kind{Type: &corev1.Secret{}},
			&handler.EnqueueRequestForOwner{
				IsController: false,
				OwnerType:    &resourcev1alpha1.SFCluster{},
			}).
		WithEventFilter(watches.NamespaceLabelFilter()).
		Complete(r)
}
