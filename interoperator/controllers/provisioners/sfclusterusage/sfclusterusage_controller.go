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

package sfclusterusage

import (
	"context"
	"os"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	corev1 "k8s.io/api/core/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

// Reconciler reconciles a Node objects and computes the capacity of cluster
type Reconciler struct {
	client.Client
	Log            logr.Logger
	uncachedClient client.Client
}

// Reconcile iterates through all nodes and computes requested resources
// and update it in sfcluster status
func (r *Reconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("SFCluster", req.NamespacedName)

	cluster := &resourcev1alpha1.SFCluster{}
	err := r.Get(ctx, req.NamespacedName, cluster)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	clusterID := cluster.GetName()
	if clusterID != constants.OwnClusterID {
		// Should compute only for own cluster
		return ctrl.Result{}, nil
	}

	nodes := &corev1.NodeList{}
	currentCapacity := make(corev1.ResourceList)
	// TODO: Verify pagination works
	for more := true; more; more = (nodes.Continue != "") {
		err = r.uncachedClient.List(ctx, nodes, client.Limit(constants.ListPaginationLimit), client.Continue(nodes.Continue))
		if err != nil {
			log.Error(err, "error while fetching nodes")
			return ctrl.Result{}, err
		}
		for _, node := range nodes.Items {
			// Allocatable is the capacity after kubelet
			resourcev1alpha1.ResourceListAdd(currentCapacity, node.Status.Allocatable)
		}
	}

	requests := make(corev1.ResourceList)
	pods := &corev1.PodList{}

	// TODO: Verify pagination works
	for more := true; more; more = (pods.Continue != "") {
		err = r.uncachedClient.List(ctx, pods, client.Limit(constants.ListPaginationLimit), client.Continue(pods.Continue))
		if err != nil {
			log.Error(err, "error while fetching pods")
			return ctrl.Result{}, err
		}
		for _, pod := range pods.Items {
			resourcev1alpha1.ResourceListAdd(requests, getResourceRequest(&pod))
		}
	}

	err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
		if !resourcev1alpha1.ResourceListEqual(requests, cluster.Status.Requests) ||
			!resourcev1alpha1.ResourceListEqual(currentCapacity, cluster.Status.CurrentCapacity) ||
			!resourcev1alpha1.ResourceListEqual(cluster.Spec.TotalCapacity, cluster.Status.TotalCapacity) {

			log.Info("updating cluster status", "currentRequests", cluster.Status.Requests, "newRequests",
				requests, "currentCapacity", cluster.Status.CurrentCapacity, "newCapacity", currentCapacity)
			cluster.Status.Requests = requests.DeepCopy()
			cluster.Status.CurrentCapacity = currentCapacity.DeepCopy()
			cluster.Status.TotalCapacity = cluster.Spec.TotalCapacity.DeepCopy()
			err = r.Status().Update(ctx, cluster)
			if err != nil {
				if apiErrors.IsConflict(err) {
					// Fetch the SFCluster instance again
					_ = r.Get(ctx, req.NamespacedName, cluster)
				}
				return err
			}
			log.Info("updated cluster status")
		}
		return nil
	})
	if err != nil {
		log.Error(err, "failed to update cluster status")
		return ctrl.Result{}, err
	}
	return ctrl.Result{}, nil
}

// SetupWithManager registers the SFCluster Usage controller with manager
// and setups the watches.
func (r *Reconciler) SetupWithManager(mgr ctrl.Manager) error {
	// Do not start the controller if it is not a k8s deployment
	// When it is a k8s deploymen, POD_NAMESPACE env is set
	_, ok := os.LookupEnv(constants.NamespaceEnvKey)
	if !ok {
		return nil
	}

	if r.uncachedClient == nil {
		uncachedClient, err := client.New(mgr.GetConfig(), client.Options{
			Scheme: mgr.GetScheme(),
			Mapper: mgr.GetRESTMapper(),
		})
		if err != nil {
			return err
		}
		r.uncachedClient = uncachedClient
	}

	watchMapper := handler.EnqueueRequestsFromMapFunc(func(a client.Object) []reconcile.Request {
		return []reconcile.Request{
			{NamespacedName: types.NamespacedName{
				Name:      constants.OwnClusterID,
				Namespace: constants.InteroperatorNamespace,
			}},
		}
	})
	builder := ctrl.NewControllerManagedBy(mgr).
		Named("scheduler_helper_sfclusterusage").
		For(&resourcev1alpha1.SFCluster{}).
		Watches(&source.Kind{Type: &corev1.Node{}}, watchMapper).
		WithEventFilter(watches.NodeFilter())

	return builder.Complete(r)
}

func getResourceRequest(pod *corev1.Pod) corev1.ResourceList {
	resources := make(corev1.ResourceList)
	for _, container := range pod.Spec.Containers {
		resourcev1alpha1.ResourceListAdd(resources, container.Resources.Requests)
	}

	for _, container := range pod.Spec.InitContainers {
		if resourcev1alpha1.ResourceListLess(resources, container.Resources.Requests) {
			resources = container.Resources.Requests.DeepCopy()
		}
	}

	// if PodOverhead feature is supported, add overhead for running a pod
	// to the total requests if the resource total is non-zero
	if pod.Spec.Overhead != nil && !resourcev1alpha1.ResourceListEqual(resources, make(corev1.ResourceList)) {
		resourcev1alpha1.ResourceListAdd(resources, pod.Spec.Overhead)
	}
	return resources
}
