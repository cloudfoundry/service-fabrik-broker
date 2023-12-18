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

package sfservicebindingmetrics

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"

	"github.com/go-logr/logr"
	"github.com/prometheus/client_golang/prometheus"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/metrics"
)

var (
	bindingsMetric = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name:      "state",
			Namespace: "interoperator",
			Subsystem: "service_bindings_metrics",
			Help:      "State of service binding. 0 - succeeded, 1 - failed, 2 - in progress, 3 - in_queue/update/delete",
		},
		[]string{
			// What was the state of the binding
			"binding_id",
			// the instance this binding belongs to
			"instance_id",
			//"labels",
			"creation_timestamp",
			"deletion_timestamp",
			"state",
			"sf_namespace",
			//"last_operation",
		},
	)
)

// BindingMetrics reconciles a SFServiceBinding object
type BindingMetrics struct {
	client.Client
	Log             logr.Logger
	clusterRegistry registry.ClusterRegistry
	cfgManager      config.Config
}

// Reconcile reads that state of the SFServiceBinding object on master cluster and send the metrics data to prometheus
func (r *BindingMetrics) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	log := r.Log.WithValues("bindingMetrics", req.NamespacedName)

	binding := &osbv1alpha1.SFServiceBinding{}
	err := r.Get(ctx, req.NamespacedName, binding)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			bindingsMetric.WithLabelValues(req.NamespacedName.Name, "", "", "", "", "").Set(4)
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	bindingID := binding.GetName()
	state := binding.GetState()
	instanceID := binding.Spec.InstanceID
	//labelsForMetrics := binding.GetLabelsForMetrics()
	creationTimestamp := binding.GetCreationTimestamp().String()
	deletionTimestamp := binding.GetDeletionTimestampForMetrics()
	sfNamespace := binding.GetNamespace()
	//lastOperation := binding.GetLastOperation()

	log.Info("Sending Metrics to prometheus for binding ", "BindingId:", bindingID, "State: ", state)

	switch state {
	case "succeeded":
		bindingsMetric.WithLabelValues(bindingID, instanceID, creationTimestamp, deletionTimestamp, state, sfNamespace).Set(0)
	case "failed":
		bindingsMetric.WithLabelValues(bindingID, instanceID, creationTimestamp, deletionTimestamp, state, sfNamespace).Set(1)
	case "in progress":
		bindingsMetric.WithLabelValues(bindingID, instanceID, creationTimestamp, deletionTimestamp, state, sfNamespace).Set(2)
	case "in_queue", "update", "delete":
		bindingsMetric.WithLabelValues(bindingID, instanceID, creationTimestamp, deletionTimestamp, state, sfNamespace).Set(3)
	}

	return ctrl.Result{}, nil
}

// SetupWithManager registers the MCD Binding replicator with manager
// and setups the watches.
func (r *BindingMetrics) SetupWithManager(mgr ctrl.Manager) error {
	if r.Log.GetSink() == nil {
		r.Log = ctrl.Log.WithName("mcd").WithName("metrics").WithName("binding")
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

	metrics.Registry.MustRegister(bindingsMetric)

	builder := ctrl.NewControllerManagedBy(mgr).
		Named("mcd_metrics_binding").
		WithOptions(controller.Options{
			MaxConcurrentReconciles: interoperatorCfg.BindingWorkerCount,
		}).
		For(&osbv1alpha1.SFServiceBinding{}).
		WithEventFilter(watches.NamespaceLabelFilter())

	return builder.Complete(r)
}
