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
	"os"
	"strings"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/dynamic"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/renderer/gotemplate"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	apiErrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/go-logr/logr"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// SFLabelSelectorScheduler reconciles a SFLabelSelectorScheduler object
type SFLabelSelectorScheduler struct {
	client.Client
	Log             logr.Logger
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile schedules the SFServiceInstance to one SFCluster and sets the ClusterID in
// SFServiceInstance.Spec.ClusterID. It chooses the cluster with least number of
// SFServiceInstances already deployed
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
		labelSelector, err := getLabelSelectorString(*instance, *r)
		if err != nil || labelSelector == "" {
			log.Info("Failed to get labelSelector string..", "error", err, "labelSelector", labelSelector)
			return ctrl.Result{}, err
		}

		clusterID, err := r.schedule(labelSelector)
		if err != nil {
			log.Error(err, "Failed to schedule ", "labelSelector", labelSelector, "clusterID", clusterID)
			return ctrl.Result{}, err
		}

		if clusterID != "" {
			log.Info("setting clusterID", "clusterID", clusterID)
			instance.Spec.ClusterID = clusterID
			if err := r.Update(ctx, instance); err != nil {
				log.Error(err, "failed to set cluster id", "clusterID", clusterID)
				return ctrl.Result{}, err
			}
		}
	}

	return ctrl.Result{}, nil
}

func getLabelSelectorString(sfServiceInstance osbv1alpha1.SFServiceInstance, r SFLabelSelectorScheduler) (string, error) {
	log := r.Log
	ctx := context.Background()

	sfNamespace := os.Getenv(constants.NamespaceEnvKey)
	if sfNamespace == "" {
		sfNamespace = constants.DefaultServiceFabrikNamespace
	}
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
	if err != nil || labelSelectorTemplate.Type != "gotemplate" {
		log.Info("plan does not have clusterlabel template")
		return "", err
	}

	content := labelSelectorTemplate.Content
	values := make(map[string]interface{})
	instanceObj, err := dynamic.ObjectToMapInterface(sfServiceInstance)
	values["instance"] = instanceObj
	if err != nil {
		return "", err
	}

	if service != nil {
		serviceObj, err := dynamic.ObjectToMapInterface(service)
		values["service"] = serviceObj
		if err != nil {
			return "", err
		}
	}
	if plan != nil {
		planObj, err := dynamic.ObjectToMapInterface(plan)
		values["plan"] = planObj
		if err != nil {
			return "", err
		}
	}

	renderer, err := gotemplate.New()
	if err != nil {
		return "", err
	}
	rendererInput := gotemplate.NewInput("", content, "test", values)
	rendererOutput, err := renderer.Render(rendererInput)
	if err != nil {
		return "", err
	}
	labelSelector, err := rendererOutput.FileContent("main")
	if err != nil {
		return "", err
	}
	return labelSelector, nil
}

func (r *SFLabelSelectorScheduler) schedule(labelSelector string) (string, error) {
	ctx := context.Background()
	log := r.Log.WithValues("labelSelector", labelSelector)
	labelSelector = strings.TrimSuffix(labelSelector, "\n")
	label, _ := labels.Parse(labelSelector)
	log.Info("Parsed Label is: ", "label", label)
	clusters, err := r.clusterRegistry.ListClusters(&client.ListOptions{
		LabelSelector: label,
	})
	if err != nil {
		return "", err
	}

	log.Info("Cluster size is", "length", len(clusters.Items))
	if len(clusters.Items) == 0 {
		log.Info("no cluster matching the criteria, returning failure")
		return "", errors.NewSchedulerFailed(constants.LabelSelectorSchedulerType, "No clusters found with matching criteria: "+labelSelector, nil)
	}
	if len(clusters.Items) == 1 {
		log.Info("Only one cluster matching the criteria", "cluster name", clusters.Items[0].GetName())
		return clusters.Items[0].GetName(), nil
	}

	sfserviceinstances := &osbv1alpha1.SFServiceInstanceList{}
	err = r.List(ctx, sfserviceinstances, &client.ListOptions{})
	if err != nil {
		log.Error(err, "failed to list all sfserviceinstances")
		return "", err
	}

	counts := make(map[string]int64)
	for _, item := range sfserviceinstances.Items {
		if item.Spec.ClusterID != "" {
			counts[item.Spec.ClusterID] = counts[item.Spec.ClusterID] + 1
		}
	}

	leastCount := int64(math.MaxInt64)
	var clusterID string
	for _, cluster := range clusters.Items {
		count := counts[cluster.GetName()]
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
		For(&osbv1alpha1.SFServiceInstance{}).
		Complete(r)
}
