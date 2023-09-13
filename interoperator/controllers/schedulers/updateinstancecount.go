//go:build schedulers
// +build schedulers

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

package schedulers

import (
	"context"

	osbv1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/osb/v1alpha1"
	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"

	ctrl "sigs.k8s.io/controller-runtime"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
)

var log = ctrl.Log.WithName("updateInstanceCount")

func updateInstanceCount(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) {

	if kubeConfig == nil {
		err := errors.NewInputError("updateInstanceCount", "kubeConfig", nil)
		log.Error(err, "invalid input")
	}

	if scheme == nil {
		err := errors.NewInputError("updateInstanceCount", "scheme", nil)
		log.Error(err, "invalid input")
	}

	err := resourcev1alpha1.AddToScheme(scheme)
	if err != nil {
		log.Error(err, "failed to create k8s client")
	}

	client, err := kubernetes.New(kubeConfig, kubernetes.Options{
		Scheme: scheme,
		Mapper: mapper,
	})
	if err != nil {
		log.Error(err, "failed to create k8s client")
	}

	ctx := context.Background()
	sfserviceinstances := &osbv1alpha1.SFServiceInstanceList{}
	instanceOptions := &kubernetes.ListOptions{}

	// Calculate the expected service instance count for each cluster
	instanceCount := make(map[string]int)
	for more := true; more; more = (sfserviceinstances.Continue != "") {
		err := client.List(ctx, sfserviceinstances, instanceOptions, kubernetes.Limit(constants.ListPaginationLimit),
			kubernetes.Continue(sfserviceinstances.Continue))
		if err != nil {
			log.Error(err, "error while fetching sfserviceinstances")
		}
		for _, sfserviceinstance := range sfserviceinstances.Items {
			for _, finalizer := range sfserviceinstance.Finalizers {
				if finalizer == constants.SFServiceInstanceCounterFinalizerName && sfserviceinstance.Spec.ClusterID != "" {
					instanceCount[sfserviceinstance.Spec.ClusterID]++
					break
				}
			}
		}
	}

	// Get the list of sfclusters
	sfClustersList := &resourcev1alpha1.SFClusterList{}
	sfclusterOptions := &kubernetes.ListOptions{
		Namespace: constants.InteroperatorNamespace,
	}
	err = client.List(ctx, sfClustersList, sfclusterOptions)
	if err != nil {
		log.Error(err, "Failed to fetch sfcluster list")
		return
	}

	// Check if there is a mismatch in the serviceinstance count in sfcluster
	// In case of mismatch, update the sfcluster with the new calculated serviceinstance count
	for _, sfCluster := range sfClustersList.Items {
		expectedServiceInstanceCount, found := instanceCount[sfCluster.Name]
		if found && sfCluster.Status.ServiceInstanceCount != expectedServiceInstanceCount {
			sfCluster.Status.ServiceInstanceCount = expectedServiceInstanceCount
			err := client.Status().Update(ctx, &sfCluster)
			if err != nil {
				log.Error(err, "While trying to update service instance count of sfcluster:", sfCluster.Name, "with new count:", expectedServiceInstanceCount)
				continue
			}
			log.Info("Success", "Updated service instance count of sfcluster:", sfCluster.Name, "with new count:", expectedServiceInstanceCount)
		}
	}
}
