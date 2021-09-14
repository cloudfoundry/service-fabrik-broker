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
	"fmt"
	"os"
	"time"

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/controllers/multiclusterdeploy/watchmanager"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/watches"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/go-logr/logr"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	v1 "k8s.io/api/rbac/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/metrics"
)

var (
	clusterMetric = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Name:      "up",
			Namespace: "interoperator",
			Subsystem: "cluster",
			Help:      "State of the cluster. 0 - down, 1 - up",
		},
		[]string{
			"cluster",
		},
	)
)

var addClusterToWatch = watchmanager.AddCluster
var removeClusterFromWatch = watchmanager.RemoveCluster

// ReconcileProvisioner reconciles a SFCluster object
type ReconcileProvisioner struct {
	client.Client
	Log             logr.Logger
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
	cfgManager      config.Config
}

// Reconcile reads the SFCluster object and makes changes based on the state read
// and what is actual state of components deployed in the sister cluster
/* Functions of this method
1. Get target cluster client and reconcile primary cluster id in configmap
2. Get deployment instance deployed in master cluster
3. Register SF CRDs in target cluster (Must be done before registering watches)
4. Add watches on resources in target sfcluster
5. Namespace creation in target cluster
6. SFCluster deploy in target cluster
7. Kubeconfig secret in target cluster
8. Create clusterrolebinding in target cluster
9. Image pull secrets in target cluster
10. Deploy provisioner in target cluster (for provisioner on master, primary cluster id
	should be injected in provisioner env)
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

	// Setting the cluster state metric as Down.
	// The cluster is ready when the reconcile completes.
	clusterMetric.WithLabelValues(clusterID).Set(0)

	//reconcile primaryClusterID in the configmap
	err = r.reconcilePrimaryClusterIDConfig()
	if err != nil {
		return ctrl.Result{}, err
	}

	// Get targetClient for targetCluster
	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		return ctrl.Result{}, err
	}

	// 2. Get deploment instance for provisioner
	deplomentInstance := &appsv1.Deployment{}
	err = r.Get(ctx, types.NamespacedName{
		Name:      constants.ProvisionerTemplateName,
		Namespace: constants.InteroperatorNamespace,
	}, deplomentInstance)
	if err != nil {
		log.Error(err, "Failed to get provisioner deployment from master cluster", "clusterId", clusterID)
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
	// Fetch current primary cluster id from configmap
	interoperatorCfg := r.cfgManager.GetConfig()
	currPrimaryClusterID := interoperatorCfg.PrimaryClusterID

	err = r.reconcileSecret(namespace, clusterInstance.Spec.SecretRef, clusterID, targetClient)
	if err != nil {
		// Skip if secret not found for leader cluster
		if !(apiErrors.IsNotFound(err) && clusterID == currPrimaryClusterID) {
			return ctrl.Result{}, err
		}
		log.Info("Ignoring secret not found error for leader cluster", "clusterId", clusterID,
			"secretRef", clusterInstance.Spec.SecretRef)
	}

	// 8. Deploy cluster rolebinding
	err = r.reconcileClusterRoleBinding(namespace, clusterID, targetClient)
	if err != nil {
		return ctrl.Result{}, err
	}

	// 9. Creating/Updating imagepull secrets for provisioner deployment in target cluster
	for _, secretRef := range deplomentInstance.Spec.Template.Spec.ImagePullSecrets {
		err = r.reconcileSecret(namespace, secretRef.Name, clusterID, targetClient)
		if err != nil {
			return ctrl.Result{}, err
		}
	}

	// 10. Create Deployment in target cluster for provisioner
	err = r.reconcileDeployment(deplomentInstance, clusterID, targetClient)
	if err != nil {
		return ctrl.Result{}, err
	}

	// Reconcile completed. Mark cluster as up
	clusterMetric.WithLabelValues(clusterID).Set(1)

	requeueAfter, err := time.ParseDuration(interoperatorCfg.ClusterReconcileInterval)
	if err != nil {
		log.Error(err, "Failed to parse ClusterReconcileInterval",
			"ClusterReconcileInterval", interoperatorCfg.ClusterReconcileInterval)
		requeueAfter, _ = time.ParseDuration(constants.DefaultClusterReconcileInterval)
	}
	return ctrl.Result{
		RequeueAfter: requeueAfter,
	}, nil
}

func (r *ReconcileProvisioner) reconcilePrimaryClusterIDConfig() error {
	ctx := context.Background()
	log := r.Log.WithName("PrimaryClusterID reconciler")
	sfClustersList := &resourcev1alpha1.SFClusterList{}
	err := r.List(ctx, sfClustersList, client.MatchingLabels{constants.PrimaryClusterKey: "true"})
	if err != nil {
		log.Error(err, "Failed to reconcile PrimaryClusterID config. Failed to fetch sfcluster list")
		return err
	}
	if len(sfClustersList.Items) == 1 {
		//update interoperator  configmap
		interoperatorCfg := r.cfgManager.GetConfig()
		interoperatorCfg.PrimaryClusterID = sfClustersList.Items[0].GetName()
		err = r.cfgManager.UpdateConfig(interoperatorCfg)
		if err != nil {
			log.Error(err, "Failed to reconcile PrimaryClusterID config. Updating configmap failed")
			return err
		}
		constants.OwnClusterID = sfClustersList.Items[0].GetName() // keep OwnClusterID up-to-date
		log.Info("Updated primary cluster id in configmap", "primaryClusterId", sfClustersList.Items[0].GetName())
	} else if len(sfClustersList.Items) > 1 {
		//more than one sfcluster has primary cluster label
		log.Error(fmt.Errorf("more than one primary cluster"), "More than one sfcluster CR with label: "+constants.PrimaryClusterKey)
		os.Exit(1)
	}
	return nil
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
		sfCRDInstance := &apiextensionsv1.CustomResourceDefinition{}

		err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
			err := r.Get(ctx, types.NamespacedName{Name: sfcrdname}, sfCRDInstance)
			if err != nil {
				log.Error(err, "Error occurred getting CRD in master cluster", "CRD", sfcrdname)
				return err
			}
			// Create/Update CRD in target cluster
			targetCRDInstance := &apiextensionsv1.CustomResourceDefinition{}
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
			return nil
		})
		if err != nil {
			log.Error(err, "Error occurred while creating/updating CRD in target cluster", "clusterId", clusterID, "CRD", sfcrdname)
			return err
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
	err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
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
	})
	if err != nil {
		log.Error(err, "Error occurred while reconciling sfcluster", "clusterId", clusterID)
		return err
	}
	return nil
}

func (r *ReconcileProvisioner) reconcileSecret(namespace string, secretName string, clusterID string, targetClient client.Client) error {
	ctx := context.Background()
	log := r.Log.WithValues("clusterID", clusterID, "secretName", secretName)

	clusterInstanceSecret := &corev1.Secret{}
	err := r.Get(ctx, types.NamespacedName{Name: secretName, Namespace: namespace}, clusterInstanceSecret)
	if err != nil {
		log.Error(err, "Failed to get the secret from master")
		return err
	}
	targetSFClusterSecret := &corev1.Secret{}
	targetSFClusterSecret.SetName(clusterInstanceSecret.GetName())
	targetSFClusterSecret.SetNamespace(clusterInstanceSecret.GetNamespace())
	targetSFClusterSecret.SetLabels(clusterInstanceSecret.GetLabels())
	targetSFClusterSecret.Type = clusterInstanceSecret.Type
	// copy Data
	targetSFClusterSecret.Data = make(map[string][]byte)
	for key, val := range clusterInstanceSecret.Data {
		targetSFClusterSecret.Data[key] = val
	}

	log.Info("Replicating secret to target cluster", "targetType", targetSFClusterSecret.Type, "sourceType", clusterInstanceSecret.Type)
	err = targetClient.Get(ctx, types.NamespacedName{
		Name:      targetSFClusterSecret.GetName(),
		Namespace: targetSFClusterSecret.GetNamespace(),
	}, &corev1.Secret{})
	if err != nil {
		if apiErrors.IsNotFound(err) {
			log.Info("secret not found in target cluster, Creating")
			err = targetClient.Create(ctx, targetSFClusterSecret)
			if err != nil {
				log.Error(err, "Error occurred while creating secret in target cluster")
				return err
			}
		} else {
			log.Error(err, "Error occurred while creating secret in target cluster")
			return err
		}
	} else {
		log.Info("Secret exist in the target cluster. Updating")
		err = targetClient.Update(ctx, targetSFClusterSecret)
		if err != nil {
			log.Error(err, "Error occurred while updating secret in target cluster")
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
		Name:      constants.ProvisionerName,
		Namespace: deploymentInstance.GetNamespace(),
	}, provisionerInstance)

	provisionerInstance.SetName(constants.ProvisionerName)
	provisionerInstance.SetNamespace(deploymentInstance.GetNamespace())
	provisionerInstance.SetLabels(deploymentInstance.GetLabels())
	// copy spec
	deploymentInstance.Spec.DeepCopyInto(&provisionerInstance.Spec)
	// set replicaCount
	replicaCount := int32(constants.ReplicaCount)
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

	err := apiextensionsv1.SchemeBuilder.AddToScheme(r.scheme)
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

	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	r.cfgManager = cfgManager

	metrics.Registry.MustRegister(clusterMetric)

	builder := ctrl.NewControllerManagedBy(mgr).
		Named("mcd_provisioner").
		WithOptions(controller.Options{
			MaxConcurrentReconciles: interoperatorCfg.ProvisionerWorkerCount,
		}).
		For(&resourcev1alpha1.SFCluster{}).
		WithEventFilter(watches.NamespaceFilter())

	return builder.Complete(r)
}
