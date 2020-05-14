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

package sflabelselectorscheduler

import (
	"context"
	"math"
	"strings"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	rendererFactory "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer/factory"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/util/retry"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
)

// SFLabelSelectorScheduler reconciles a SFLabelSelectorScheduler object
type SFLabelSelectorScheduler struct {
	client.Client
	Log             logr.Logger
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile schedules the SFServiceInstance to one SFCluster and sets the ClusterID in
// SFServiceInstance.Spec.ClusterID. It chooses the destination cluster based on clusterSelector
// template provided in the plan.
func (r *SFLabelSelectorScheduler) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("sfserviceinstance", req.NamespacedName)

	instance := &osbv1alpha1.SFServiceInstance{}
	err := r.Get(ctx, req.NamespacedName, instance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return ctrl.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}

	if instance.Spec.ClusterID == "" {
		labelSelector, err := getLabelSelectorString(instance, r)
		if err != nil {
			log.Info("Failed to get labelSelector string..", "error", err, "labelSelector", labelSelector)
			return ctrl.Result{}, err
		}

		clusterID, err := r.schedule(instance, labelSelector)
		if err != nil {
			log.Error(err, "Failed to schedule ", "labelSelector", labelSelector, "clusterID", clusterID)
			if errors.SchedulerFailed(err) {
				return ctrl.Result{}, nil
			}
			return ctrl.Result{}, err
		}

		if clusterID != "" {
			log.Info("Setting clusterID", "clusterID", clusterID)
			err = retry.RetryOnConflict(retry.DefaultRetry, func() error {
				err = r.Get(ctx, req.NamespacedName, instance)
				if err != nil {
					return err
				}
				instance.Spec.ClusterID = clusterID
				return r.Update(ctx, instance)
			})
			if err != nil {
				log.Error(err, "Failed to set cluster id", "clusterID", clusterID)
				return ctrl.Result{}, err
			}
		}
	}

	return ctrl.Result{}, nil
}

func getLabelSelectorString(sfServiceInstance *osbv1alpha1.SFServiceInstance, r *SFLabelSelectorScheduler) (string, error) {
	log := r.Log.WithValues("instance", sfServiceInstance.GetName())
	ctx := context.Background()

	sfNamespace := constants.InteroperatorNamespace
	plan := &osbv1alpha1.SFPlan{}
	namespacedName := types.NamespacedName{
		Name:      sfServiceInstance.Spec.PlanID,
		Namespace: sfNamespace,
	}
	err := r.Get(ctx, namespacedName, plan)
	if err != nil {
		return "", err
	}
	service := &osbv1alpha1.SFService{}
	namespacedName = types.NamespacedName{
		Name:      sfServiceInstance.Spec.ServiceID,
		Namespace: sfNamespace,
	}
	err = r.Get(ctx, namespacedName, service)
	if err != nil {
		return "", err
	}

	labelSelectorTemplate, err := plan.GetTemplate(osbv1alpha1.ClusterLabelSelectorAction)
	if err != nil {
		if errors.TemplateNotFound(err) {
			log.Info("Plan does not have clusterSelector template", "Plan", sfServiceInstance.Spec.PlanID)
			// don't return error here. In cases when clusterSelector is not provided, scheduling should happen with least utilized cluster strategy
			return "", nil
		}
		return "", err
	}

	if labelSelectorTemplate.Type != constants.GoTemplateType {
		log.Info("Plan does not have clusterSelector gotemplate", "Plan", sfServiceInstance.Spec.PlanID)
		// don't return error here. In cases when clusterSelector is not of gotemplate, scheduling should happen with least utilized cluster strategy
		return "", nil
	}

	renderer, err := rendererFactory.GetRenderer(labelSelectorTemplate.Type, nil)
	if err != nil {
		return "", err
	}
	name := types.NamespacedName{
		Namespace: sfServiceInstance.GetNamespace(),
		Name:      sfServiceInstance.GetName(),
	}
	rendererInput, err := rendererFactory.GetRendererInput(labelSelectorTemplate, service, plan, sfServiceInstance, nil, name)
	if err != nil {
		return "", err
	}
	rendererOutput, err := renderer.Render(rendererInput)
	if err != nil {
		return "", err
	}
	labelSelector, err := rendererOutput.FileContent("main")
	if err != nil {
		return "", err
	}
	return strings.TrimSuffix(labelSelector, "\n"), nil
}

func (r *SFLabelSelectorScheduler) schedule(sfServiceInstance *osbv1alpha1.SFServiceInstance, labelSelector string) (string, error) {
	log := r.Log.WithValues("instance", sfServiceInstance.GetName(), "labelSelector", labelSelector)
	label, err := labels.Parse(labelSelector)
	if err != nil {
		return "", errors.NewSchedulerFailed(constants.LabelSelectorSchedulerType, "Parsing failed for labelSelector: "+labelSelector, err)
	}
	log.Info("Parsed Label is: ", "label", label)
	clusters := &resourcev1alpha1.SFClusterList{}
	if labelSelector == "" {
		clusters, err = r.clusterRegistry.ListClusters(&client.ListOptions{})
	} else {
		clusters, err = r.clusterRegistry.ListClusters(&client.ListOptions{
			LabelSelector: label,
		})
		if err != nil {
			return "", err
		}
	}

	log.Info("Cluster size is", "length", len(clusters.Items))
	if len(clusters.Items) == 0 {
		log.Info("No cluster matching the criteria, returning failure")
		return "", errors.NewSchedulerFailed(constants.LabelSelectorSchedulerType, "No clusters found with matching criteria: "+labelSelector, nil)
	}
	if len(clusters.Items) == 1 {
		log.Info("Only one cluster matching the criteria", "cluster name", clusters.Items[0].GetName())
		return clusters.Items[0].GetName(), nil
	}

	leastCount := int(math.MaxInt64)
	var clusterID string
	for _, cluster := range clusters.Items {
		log.Info("Cluster Info", "cluster name", cluster.GetName(), "cluster filled", cluster.Status.ServiceInstanceCount)
		count := cluster.Status.ServiceInstanceCount
		if count < leastCount {
			leastCount = count
			clusterID = cluster.GetName()
			if count == 0 {
				break
			}
		}
	}
	return clusterID, nil
}

// SetupWithManager registers the least utilized scheduler with manager
// and setups the watches.
func (r *SFLabelSelectorScheduler) SetupWithManager(mgr ctrl.Manager) error {
	clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	r.clusterRegistry = clusterRegistry

	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	if interoperatorCfg.SchedulerType != constants.LabelSelectorSchedulerType {
		return nil
	}

	r.scheme = mgr.GetScheme()

	return ctrl.NewControllerManagedBy(mgr).
		Named("scheduler_labelselector").
		WithOptions(controller.Options{
			MaxConcurrentReconciles: interoperatorCfg.InstanceWorkerCount,
		}).
		For(&osbv1alpha1.SFServiceInstance{}).
		WithEventFilter(watches.NamespaceLabelFilter()).
		Complete(r)
}
