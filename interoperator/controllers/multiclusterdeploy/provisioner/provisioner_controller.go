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

package provisioner

import (
	"context"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/watchmanager"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/provisioner"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"

	"github.com/go-logr/logr"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	v1 "k8s.io/api/rbac/v1"
	apiextensionsv1beta1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1beta1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
)

var addClusterToWatch = watchmanager.AddCluster
var removeClusterFromWatch = watchmanager.RemoveCluster

// ReconcileProvisioner reconciles a SFCluster object
type ReconcileProvisioner struct {
	client.Client
	Log             logr.Logger
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
	provisioner     provisioner.Provisioner
}

// Reconcile reads the SFCluster object and makes changes based on the state read
// and what is actual state of components deployed in the sister cluster
/* Functions of this method
1. Get target cluster client
2. Get deployment instance deployed in master cluster
3. Register SF CRDs in target cluster (Must be done before registering watches)
4. Add watches on resources in target sfcluster
5. Namespace creation in target cluster
6. SFCluster deploy in target cluster
7. Kubeconfig secret in target cluster
8. Create clusterrolebinding in target cluster
9. Deploy provisioner in target cluster
*/
func (r *ReconcileProvisioner) Reconcile(req ctrl.Request) (ctrl.Result, error) {
	ctx := context.Background()
	log := r.Log.WithValues("sfcluster", req.NamespacedName)

	// Fetch the SFCluster
	clusterInstance := &resourcev1alpha1.SFCluster{}
	err := r.Get(ctx, req.NamespacedName, clusterInstance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.
			err = removeClusterFromWatch(req.Name)
			if err != nil {
				return ctrl.Result{}, err
			}
			return ctrl.Result{}, nil
		}
		log.Error(err, "Failed to get SFCluster...", "clusterId", req.NamespacedName.Name)
		// Error reading the object - requeue the request.
		return ctrl.Result{}, err
	}
	clusterID := clusterInstance.GetName()
	log.Info("reconciling cluster", "clusterID", clusterID)

	// Get targetClient for targetCluster
	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		return ctrl.Result{}, err
	}

	// Get deploment instance for provisioner
	deplomentInstance, err := r.provisioner.Get()
	if err != nil {
		return ctrl.Result{}, err
	}

	// 3. Register sf CRDs
	err = r.registerSFCrds(clusterID, targetClient)
	if err != nil {
		return ctrl.Result{}, err
	}

	// 4. Add watches on resources in target sfcluster. Must be done after
	// registering sf crds, since we are trying to watch on sfserviceinstance
	// and sfservicebinding.
	err = addClusterToWatch(clusterID)
	if err != nil {
		return ctrl.Result{}, err
	}

	// 5. Create/Update Namespace in target cluster for provisioner
	namespace := deplomentInstance.GetNamespace()
	err = r.reconcileNamespace(namespace, clusterID, targetClient)
	if err != nil {
		return ctrl.Result{}, err
	}

	// 6. Creating/Updating sfcluster in target cluster
	err = r.reconcileSfClusterCrd(clusterInstance, clusterID, targetClient)
	if err != nil {
		return ctrl.Result{}, err
	}

	// 7. Creating/Updating kubeconfig secret for sfcluster in target cluster
	err = r.reconcileSfClusterSecret(namespace, clusterInstance.Spec.SecretRef, clusterID, targetClient)
	if err != nil {
		return ctrl.Result{}, err
	}

	// 8. Deploy cluster rolebinding
	err = r.reconcileClusterRoleBinding(namespace, clusterID, targetClient)
	if err != nil {
		return ctrl.Result{}, err
	}

	// 9. Create Deployment in target cluster for provisioner
	err = r.reconcileDeployment(deplomentInstance, clusterID, targetClient)
	if err != nil {
		return ctrl.Result{}, err
	}

	return ctrl.Result{}, nil
}

func (r *ReconcileProvisioner) registerSFCrds(clusterID string, targetClient client.Client) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", clusterID)

	SFCrdNames := []string{
		"sfplans.osb.servicefabrik.io",
		"sfservices.osb.servicefabrik.io",
		"sfserviceinstances.osb.servicefabrik.io",
		"sfservicebindings.osb.servicefabrik.io",
		"sfclusters.resource.servicefabrik.io",
	}
	for _, sfcrdname := range SFCrdNames {
		// Get crd registered in master cluster
		sfCRDInstance := &apiextensionsv1beta1.CustomResourceDefinition{}
		err := r.Get(ctx, types.NamespacedName{Name: sfcrdname}, sfCRDInstance)
		if err != nil {
			log.Error(err, "Error occurred geeting CRD in master cluster", "CRD", sfcrdname)
			return err
		}
		// Create/Update CRD in target cluster
		targetCRDInstance := &apiextensionsv1beta1.CustomResourceDefinition{}
		err = targetClient.Get(ctx, types.NamespacedName{
			Name: sfCRDInstance.GetName(),
		}, targetCRDInstance)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				log.Info("CRD in target cluster not found, Creating...", "clusterId", clusterID, "CRD", sfcrdname)
				targetCRDInstance.SetName(sfCRDInstance.GetName())
				targetCRDInstance.SetLabels(sfCRDInstance.GetLabels())
				// copy spec
				sfCRDInstance.Spec.DeepCopyInto(&targetCRDInstance.Spec)
				sfCRDInstance.Status.DeepCopyInto(&targetCRDInstance.Status)
				err = targetClient.Create(ctx, targetCRDInstance)
				if err != nil {
					log.Error(err, "Error occurred while creating CRD in target cluster", "clusterId", clusterID, "CRD", sfcrdname)
					return err
				}
			} else {
				log.Error(err, "Error occurred while getting CRD in target cluster", "clusterId", clusterID, "CRD", sfcrdname)
				return err
			}
		} else {
			targetCRDInstance.SetName(sfCRDInstance.GetName())
			targetCRDInstance.SetLabels(sfCRDInstance.GetLabels())
			// copy spec
			sfCRDInstance.Spec.DeepCopyInto(&targetCRDInstance.Spec)
			sfCRDInstance.Status.DeepCopyInto(&targetCRDInstance.Status)

			log.Info("Updating CRD in target cluster", "Cluster", clusterID, "CRD", sfcrdname)
			err = targetClient.Update(ctx, targetCRDInstance)
			if err != nil {
				log.Error(err, "Error occurred while updating CRD in target cluster", "clusterId", clusterID, "CRD", sfcrdname)
				return err
			}
		}
	}
	return nil
}

func (r *ReconcileProvisioner) reconcileNamespace(namespace string, clusterID string, targetClient client.Client) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", clusterID)

	ns := &corev1.Namespace{}
	err := targetClient.Get(ctx, types.NamespacedName{
		Name: namespace,
	}, ns)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			log.Info("creating namespace in target cluster", "clusterID", clusterID,
				"namespace", namespace)
			ns.SetName(namespace)
			err = targetClient.Create(ctx, ns)
			if err != nil {
				log.Error(err, "Failed to create namespace in target cluster", "namespace", namespace,
					"clusterID", clusterID)
				// Error updating the object - requeue the request.
				return err
			}
			log.Info("Created namespace in target cluster", "namespace", namespace,
				"clusterID", clusterID)
		} else {
			log.Error(err, "Failed to fetch namespace from target cluster", "namespace", namespace,
				"clusterID", clusterID)
			return err
		}
	}
	return nil
}

func (r *ReconcileProvisioner) reconcileSfClusterCrd(clusterInstance *resourcev1alpha1.SFCluster, clusterID string, targetClient client.Client) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", clusterID)

	targetSFCluster := &resourcev1alpha1.SFCluster{}
	err := targetClient.Get(ctx, types.NamespacedName{
		Name:      clusterInstance.GetName(),
		Namespace: clusterInstance.GetNamespace(),
	}, targetSFCluster)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			log.Info("SFCluster not found, Creating...", "clusterId", clusterID)
			targetSFCluster.SetName(clusterInstance.GetName())
			targetSFCluster.SetNamespace(clusterInstance.GetNamespace())
			targetSFCluster.SetLabels(clusterInstance.GetLabels())
			// copy spec
			clusterInstance.Spec.DeepCopyInto(&targetSFCluster.Spec)
			err = targetClient.Create(ctx, targetSFCluster)
			if err != nil {
				log.Error(err, "Error occurred while creating sfcluster", "clusterId", clusterID)
				// Error updating the object - requeue the request.
				return err
			}
			log.Info("Created SFCluster in target cluster", "clusterID", clusterID)
		} else {
			log.Error(err, "Error occurred while sfcluster provisioner", "clusterId", clusterID)
			return err
		}
	} else {
		targetSFCluster.SetName(clusterInstance.GetName())
		targetSFCluster.SetNamespace(clusterInstance.GetNamespace())
		targetSFCluster.SetLabels(clusterInstance.GetLabels())
		// copy spec
		clusterInstance.Spec.DeepCopyInto(&targetSFCluster.Spec)
		log.Info("Updating SFCluster in target cluster", "Cluster", clusterID)
		err = targetClient.Update(ctx, targetSFCluster)
		if err != nil {
			log.Error(err, "Error occurred while updating sfcluster provisioner", "clusterId", clusterID)
			return err
		}
	}
	return nil
}

func (r *ReconcileProvisioner) reconcileSfClusterSecret(namespace string, secretName string, clusterID string, targetClient client.Client) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", clusterID)

	clusterInstanceSecret := &corev1.Secret{}
	err := r.Get(ctx, types.NamespacedName{Name: secretName, Namespace: namespace}, clusterInstanceSecret)
	if err != nil {
		log.Error(err, "Failed to get the kubeconfig secret for sfcluster in master...", "clusterId", clusterID, "kubeconfig-secret", secretName)
		return err
	}
	targetSFClusterSecret := &corev1.Secret{}
	targetSFClusterSecret.SetName(clusterInstanceSecret.GetName())
	targetSFClusterSecret.SetNamespace(clusterInstanceSecret.GetNamespace())
	targetSFClusterSecret.SetLabels(clusterInstanceSecret.GetLabels())
	// copy Data
	targetSFClusterSecret.Data = make(map[string][]byte)
	for key, val := range clusterInstanceSecret.Data {
		targetSFClusterSecret.Data[key] = val
	}
	log.Info("Updating kubeconfig secret for sfcluster in target cluster", "Cluster", clusterID)
	err = targetClient.Get(ctx, types.NamespacedName{
		Name:      targetSFClusterSecret.GetName(),
		Namespace: targetSFClusterSecret.GetNamespace(),
	}, targetSFClusterSecret)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			log.Info("kubeconfig secret for sfcluster in target cluster not found, Creating...", "clusterId", clusterID)
			err = targetClient.Create(ctx, targetSFClusterSecret)
			if err != nil {
				log.Error(err, "Error occurred while creating kubeconfig secret for sfcluster in target cluster", "clusterId", clusterID)
				return err
			}
		} else {
			log.Error(err, "Error occurred while creating kubeconfig secret for sfcluster in target cluster", "clusterId", clusterID)
			return err
		}
	} else {
		err = targetClient.Update(ctx, targetSFClusterSecret)
		if err != nil {
			log.Error(err, "Error occurred while updating kubeconfig secret for sfcluster in target cluster", "clusterId", clusterID)
			return err
		}
	}
	return nil
}

func (r *ReconcileProvisioner) reconcileDeployment(deploymentInstance *appsv1.Deployment, clusterID string, targetClient client.Client) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", clusterID)

	provisionerInstance := &appsv1.Deployment{}

	log.Info("Updating provisioner", "Cluster", clusterID)
	getDeploymentErr := targetClient.Get(ctx, types.NamespacedName{
		Name:      deploymentInstance.GetName(),
		Namespace: deploymentInstance.GetNamespace(),
	}, provisionerInstance)

	provisionerInstance.SetName(deploymentInstance.GetName())
	provisionerInstance.SetNamespace(deploymentInstance.GetNamespace())
	provisionerInstance.SetLabels(deploymentInstance.GetLabels())
	// copy spec
	deploymentInstance.Spec.DeepCopyInto(&provisionerInstance.Spec)
	// set replicaCount to 1
	replicaCount := int32(1)
	provisionerInstance.Spec.Replicas = &replicaCount

	// set env CLUSTER_ID for containers
ContainersLoop:
	for i := range provisionerInstance.Spec.Template.Spec.Containers {
		clusterIDEnv := &corev1.EnvVar{
			Name:  constants.OwnClusterIDEnvKey,
			Value: clusterID,
		}
		for key, val := range provisionerInstance.Spec.Template.Spec.Containers[i].Env {
			if val.Name == constants.OwnClusterIDEnvKey {
				provisionerInstance.Spec.Template.Spec.Containers[i].Env[key].Value = clusterID
				continue ContainersLoop
			}
		}
		provisionerInstance.Spec.Template.Spec.Containers[i].Env = append(provisionerInstance.Spec.Template.Spec.Containers[i].Env, *clusterIDEnv)
	}

	if getDeploymentErr != nil {
		if apiErrors.IsNotFound(getDeploymentErr) {
			log.Info("Provisioner not found, Creating...", "clusterId", clusterID)
			err := targetClient.Create(ctx, provisionerInstance)
			if err != nil {
				log.Error(err, "Error occurred while creating provisioner", "clusterId", clusterID)
				return err
			}
		} else {
			log.Error(getDeploymentErr, "Error occurred while creating provisioner", "clusterId", clusterID)
			return getDeploymentErr
		}
	} else {
		err := targetClient.Update(ctx, provisionerInstance)
		if err != nil {
			log.Error(err, "Error occurred while updating provisioner", "clusterId", clusterID)
			return err
		}
	}
	return nil
}

func (r *ReconcileProvisioner) reconcileClusterRoleBinding(namespace string, clusterID string, targetClient client.Client) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", clusterID)

	clusterRoleBinding := &v1.ClusterRoleBinding{}
	clusterRoleBinding.SetName("provisioner-clusterrolebinding")
	clusterRoleBindingSubject := &v1.Subject{
		Kind:      "ServiceAccount",
		Name:      "default",
		Namespace: namespace,
	}
	clusterRoleRef := &v1.RoleRef{
		APIGroup: "rbac.authorization.k8s.io",
		Kind:     "ClusterRole",
		Name:     "cluster-admin",
	}
	clusterRoleBinding.Subjects = append(clusterRoleBinding.Subjects, *clusterRoleBindingSubject)
	clusterRoleBinding.RoleRef = *clusterRoleRef
	log.Info("Updating clusterRoleBinding", "clusterId", clusterID)
	err := targetClient.Get(ctx, types.NamespacedName{
		Name:      clusterRoleBinding.GetName(),
		Namespace: clusterRoleBinding.GetNamespace(),
	}, clusterRoleBinding)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			log.Info("ClusterRoleBinding not found, creating role binding", "clusterId", clusterID)
			err = targetClient.Create(ctx, clusterRoleBinding)
			if err != nil {
				log.Error(err, "Error occurred while creating ClusterRoleBinding", "clusterId", clusterID)
				return err
			}
		} else {
			log.Error(err, "Error occurred while creating ClusterRoleBinding", "clusterId", clusterID)
			return err
		}
	} else {
		err = targetClient.Update(ctx, clusterRoleBinding)
		if err != nil {
			log.Error(err, "Error occurred while updating ClusterRoleBinding", "clusterId", clusterID)
			return err
		}
	}
	return nil
}

// SetupWithManager registers the MCD Provisioner with manager
// and setups the watches.
func (r *ReconcileProvisioner) SetupWithManager(mgr ctrl.Manager) error {
	r.scheme = mgr.GetScheme()

	err := apiextensionsv1beta1.SchemeBuilder.AddToScheme(r.scheme)
	if err != nil {
		return err
	}

	if r.Log == nil {
		r.Log = ctrl.Log.WithName("mcd").WithName("provisioner")
	}
	if r.clusterRegistry == nil {
		clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
		if err != nil {
			return err
		}
		r.clusterRegistry = clusterRegistry
	}

	if r.provisioner == nil {
		provisionerMgr, err := provisioner.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
		if err != nil {
			return err
		}
		r.provisioner = provisionerMgr
	}

	err = r.provisioner.Fetch()
	if err != nil {
		return err
	}

	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()

	builder := ctrl.NewControllerManagedBy(mgr).
		Named("mcd_provisioner").
		WithOptions(controller.Options{
			MaxConcurrentReconciles: interoperatorCfg.ProvisionerWorkerCount,
		}).
		For(&resourcev1alpha1.SFCluster{})

	return builder.Complete(r)
}
