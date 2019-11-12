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

	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/types"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/osb/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/dynamic"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/renderer/gotemplate"

	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var log = logf.Log.WithName("sflabelselector.scheduler")

// Add creates a new SFLeastUtilizedScheduler Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
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
	return &ReconcileSFLeastUtilizedScheduler{
		Client:          mgr.GetClient(),
		scheme:          mgr.GetScheme(),
		clusterRegistry: clusterRegistry,
	}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	if interoperatorCfg.SchedulerType != constants.LabelSelectorSchedulerType {
		return nil
	}

	// Create a new controller
	c, err := controller.New("sflabelselectorscheduler-controller", mgr, controller.Options{Reconciler: r})
	if err != nil {
		return err
	}

	// Watch for changes to SFLeastUtilizedScheduler
	err = c.Watch(&source.Kind{Type: &osbv1alpha1.SFServiceInstance{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileSFLeastUtilizedScheduler{}

// ReconcileSFLeastUtilizedScheduler reconciles a SFLeastUtilizedScheduler object
type ReconcileSFLeastUtilizedScheduler struct {
	client.Client
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
}

// Reconcile schedules the SFServiceInstance to one SFCluster and sets the ClusterID in
// SFServiceInstance.Spec.ClusterID. It chooses the cluster with least number of
// SFServiceInstances already deployed
func (r *ReconcileSFLeastUtilizedScheduler) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	ctx := context.TODO()
	// Fetch the SFLeastUtilizedScheduler instance
	instance := &osbv1alpha1.SFServiceInstance{}
	err := r.Get(ctx, request.NamespacedName, instance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.  Created objects are automatically garbage collected.
			// For additional cleanup logic use finalizers.
			return reconcile.Result{}, nil
		}
		// Error reading the object - requeue the request.
		return reconcile.Result{}, err
	}

	if instance.Spec.ClusterID == "" {
		labelSelector := getLabelSelectorString(ctx, *instance, *r)
		//labelSelector := ""
		clusterID, err := r.schedule(labelSelector)
		if err != nil {
			return reconcile.Result{}, err
		}

		if clusterID != "" {
			log.Info("setting clusterID", "instanceID", instance.GetName(), "clusterID", clusterID)
			instance.Spec.ClusterID = clusterID
			if err := r.Update(ctx, instance); err != nil {
				log.Error(err, "failed to set cluster id", "instanceID", instance.GetName(), "clusterID", clusterID)
				return reconcile.Result{}, err
			}
		}
	}

	return reconcile.Result{}, nil
}

func getLabelSelectorString(ctx context.Context, sfServiceInstance osbv1alpha1.SFServiceInstance, r ReconcileSFLeastUtilizedScheduler) string {
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
		return ""
	}
	service := &osbv1alpha1.SFService{}
	namespacedName = types.NamespacedName{
		Name:      sfServiceInstance.Spec.ServiceID,
		Namespace: sfNamespace,
	}
	err = r.Get(ctx, namespacedName, service)
	if err != nil {
		return ""
	}

	labelSelectorTemplate, err := plan.GetTemplate(osbv1alpha1.ClusterLabelSelectorAction)
	if err != nil || labelSelectorTemplate.Type != "gotemplate" {
		log.Info("plan does not have clusterlabel template")
		return ""
	}

	content := labelSelectorTemplate.Content
	values := make(map[string]interface{})
	instanceObj, err := dynamic.ObjectToMapInterface(sfServiceInstance)
	values["instance"] = instanceObj
	if err != nil {
		return ""
	}

	if service != nil {
		serviceObj, err := dynamic.ObjectToMapInterface(service)
		values["service"] = serviceObj
		if err != nil {
			return ""
		}
	}
	if plan != nil {
		planObj, err := dynamic.ObjectToMapInterface(plan)
		values["plan"] = planObj
		if err != nil {
			return ""
		}
	}

	renderer, err := gotemplate.New()
	if err != nil {
		return ""
	}
	rendererInput := gotemplate.NewInput("", content, "test", values)
	rendererOutput, err := renderer.Render(rendererInput)
	if err != nil {
		return ""
	}
	labelSelector, err := rendererOutput.FileContent("main")
	if err != nil {
		return ""
	}
	return labelSelector
}

func (r *ReconcileSFLeastUtilizedScheduler) schedule(labelSelector string) (string, error) {
	log.Info("labelSelector is", "labelSelector", labelSelector)
	labelSelector = strings.TrimSuffix(labelSelector, "\n")
	log.Info("labelSelector is", "labelSelector", labelSelector)
	// labelSelector = strings.TrimPrefix(labelSelector, "\n")
	// log.Info("labelSelector is", "labelSelector", labelSelector)
	label, _ := labels.Parse(labelSelector)
	log.Info("Label is", "label", label)
	clusters, err := r.clusterRegistry.ListClusters(&client.ListOptions{
		LabelSelector: label,
	})
	if err != nil {
		return "", err
	}

	log.Info("Cluster size is", "length", len(clusters.Items))
	if len(clusters.Items) == 0 {
		log.Info("no cluster matching the criteria, getting all the clusters")
		clusters, err = r.clusterRegistry.ListClusters(&client.ListOptions{})
		if err != nil {
			return "", err
		}
	}
	if len(clusters.Items) == 1 {
		log.Info("Only one cluster matching the criteria", "cluster name", clusters.Items[0].GetName())
		return clusters.Items[0].GetName(), nil
	}

	sfserviceinstances := &osbv1alpha1.SFServiceInstanceList{}
	err = r.List(context.TODO(), &client.ListOptions{}, sfserviceinstances)
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
