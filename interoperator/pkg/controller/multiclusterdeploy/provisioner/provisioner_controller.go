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

	resourcev1alpha1 "github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis/resource/v1alpha1"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/cluster/registry"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/controller/multiclusterdeploy/watchmanager"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/config"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/internal/provisioner"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	v1 "k8s.io/api/rbac/v1"
	apiextensionsv1beta1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1beta1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/controller"
	"sigs.k8s.io/controller-runtime/pkg/handler"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	"sigs.k8s.io/controller-runtime/pkg/reconcile"
	logf "sigs.k8s.io/controller-runtime/pkg/runtime/log"
	"sigs.k8s.io/controller-runtime/pkg/source"
)

var log = logf.Log.WithName("provisioner.controller")

/**
* USER ACTION REQUIRED: This is a scaffold file intended for the user to modify with their own Controller
* business logic.  Delete these comments after modifying this file.*
 */

// Add creates a new SFDefaultScheduler Controller and adds it to the Manager with default RBAC. The Manager will set fields on the Controller
// and Start it when the Manager is Started.
// USER ACTION REQUIRED: update cmd/manager/main.go to call this osb.Add(mgr) to install this Controller
func Add(mgr manager.Manager) error {
	clusterRegistry, err := registry.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	provisionerMgr, err := provisioner.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	err = provisionerMgr.FetchStatefulset()
	if err != nil {
		return err
	}

	return add(mgr, newReconciler(mgr, clusterRegistry, provisionerMgr))
}

// newReconciler returns a new reconcile.Reconciler
func newReconciler(mgr manager.Manager, clusterRegistry registry.ClusterRegistry, provisionerMgr provisioner.Provisioner) reconcile.Reconciler {
	return &ReconcileProvisioner{
		Client:          mgr.GetClient(),
		scheme:          mgr.GetScheme(),
		clusterRegistry: clusterRegistry,
		provisioner:     provisionerMgr,
	}
}

// add adds a new Controller to mgr with r as the reconcile.Reconciler
func add(mgr manager.Manager, r reconcile.Reconciler) error {
	cfgManager, err := config.New(mgr.GetConfig(), mgr.GetScheme(), mgr.GetRESTMapper())
	if err != nil {
		return err
	}
	interoperatorCfg := cfgManager.GetConfig()
	// Create a new controller
	c, err := controller.New("provisioner-controller", mgr, controller.Options{
		Reconciler:              r,
		MaxConcurrentReconciles: interoperatorCfg.ProvisionerWorkerCount,
	})
	if err != nil {
		return err
	}

	// Watch for changes to SFDefaultScheduler
	err = c.Watch(&source.Kind{Type: &resourcev1alpha1.SFCluster{}}, &handler.EnqueueRequestForObject{})
	if err != nil {
		return err
	}

	return nil
}

var _ reconcile.Reconciler = &ReconcileProvisioner{}

// ReconcileProvisioner reconciles a SFDefaultScheduler object
type ReconcileProvisioner struct {
	client.Client
	scheme          *runtime.Scheme
	clusterRegistry registry.ClusterRegistry
	provisioner     provisioner.Provisioner
}

// Reconcile reads that state of the cluster for a SFDefaultScheduler object and makes changes based on the state read
// and what is in the SFDefaultScheduler.Spec
// TODO(user): Modify this Reconcile function to implement your Controller logic.  The scaffolding writes
// a Deployment as an example
/* Functions of this method
1. Add watches on resources in target sfcluster
2. Get target cluster client
3. Get statefulset instance deployed in master cluster
4. Register SF CRDs in target cluster
5. Namespace creation in target cluster
6. SFCluster deploy in target cluster
7. Kubeconfig secret in target cluster
8. Deploy provisioner in target cluster
9. Create clusterrolebinding in target cluster
*/
func (r *ReconcileProvisioner) Reconcile(request reconcile.Request) (reconcile.Result, error) {
	// Fetch the SFCluster
	clusterInstance := &resourcev1alpha1.SFCluster{}
	err := r.Get(context.TODO(), request.NamespacedName, clusterInstance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			// Object not found, return.
			err = watchmanager.RemoveCluster(request.Name)
			if err != nil {
				return reconcile.Result{}, err
			}
			return reconcile.Result{}, nil
		}
		log.Error(err, "Failed to get SFCluster...", "clusterId", request.NamespacedName.Name)
		// Error reading the object - requeue the request.
		return reconcile.Result{}, err
	}
	clusterID := clusterInstance.GetName()
	log.Info("reconciling cluster", "clusterID", clusterID)

	err = watchmanager.AddCluster(clusterID)
	if err != nil {
		return reconcile.Result{}, err
	}

	// Get targetClient for targetCluster
	targetClient, err := r.clusterRegistry.GetClient(clusterID)
	if err != nil {
		return reconcile.Result{}, err
	}

	// Get statefulSetInstance for provisioner
	statefulSetInstance := r.provisioner.GetStatefulSet()

	// Register sf CRDs
	SFCrdNames := []string{
		"sfplans.osb.servicefabrik.io",
		"sfservice.osb.servicefabrik.io",
		"sfserviceinstance.osb.servicefabrik.io",
		"sfservicebinding.osb.servicefabrik.io",
		"sfcluster.osb.servicefabrik.io",
	}
	for _, sfcrdname := range SFCrdNames {
		// Get crd registered in master cluster
		sfCRDInstance := &apiextensionsv1beta1.CustomResourceDefinition{}
		err = r.Get(context.TODO(), types.NamespacedName{Name: sfcrdname}, sfCRDInstance)
		if err != nil {
			return reconcile.Result{}, err
		}
		// Create/Update CRD in target cluster
		targetCRDInstance := &apiextensionsv1beta1.CustomResourceDefinition{}
		targetCRDInstance.SetName(sfCRDInstance.GetName())
		targetCRDInstance.SetLabels(sfCRDInstance.GetLabels())
		// copy spec
		sfCRDInstance.Spec.DeepCopyInto(&targetCRDInstance.Spec)

		log.Info("Updating CRD in target cluster", "Cluster", clusterID, "CRD", sfcrdname)
		err = targetClient.Update(context.TODO(), targetCRDInstance)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				log.Info("CRD in target cluster not found, Creating...", "clusterId", clusterID, "CRD", sfcrdname)
				err = targetClient.Create(context.TODO(), targetCRDInstance)
				if err != nil {
					log.Error(err, "Error occurred while creating CRD in target cluster", "clusterId", clusterID, "CRD", sfcrdname)
					return reconcile.Result{}, err
				}
			} else {
				log.Error(err, "Error occurred while updating CRD in target cluster", "clusterId", clusterID, "CRD", sfcrdname)
				return reconcile.Result{}, err
			}
		}
	}

	// Create/Update Namespace in target cluster for provisioner
	ns := &corev1.Namespace{}
	namespace := statefulSetInstance.GetNamespace()

	err = targetClient.Get(context.TODO(), types.NamespacedName{
		Name: namespace,
	}, ns)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			log.Info("creating namespace in target cluster", "clusterID", clusterID,
				"namespace", namespace)
			ns.SetName(namespace)
			err = targetClient.Create(context.TODO(), ns)
			if err != nil {
				log.Error(err, "Failed to create namespace in target cluster", "namespace", namespace,
					"clusterID", clusterID)
				// Error updating the object - requeue the request.
				return reconcile.Result{}, err
			}
			log.Info("Created namespace in target cluster", "namespace", namespace,
				"clusterID", clusterID)
		} else {
			log.Error(err, "Failed to fetch namespace from target cluster", "namespace", namespace,
				"clusterID", clusterID)
			return reconcile.Result{}, err
		}
	}

	// Creating/Updating sfcluster in target cluster
	targetSFCluster := &resourcev1alpha1.SFCluster{}
	err = targetClient.Get(context.TODO(), types.NamespacedName{
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
			err = targetClient.Create(context.TODO(), targetSFCluster)
			if err != nil {
				log.Error(err, "Error occurred while creating sfcluster", "clusterId", clusterID)
				// Error updating the object - requeue the request.
				return reconcile.Result{}, err
			}
			log.Info("Created SFCluster in target cluster", "clusterID", clusterID)
		} else {
			log.Error(err, "Error occurred while sfcluster provisioner", "clusterId", clusterID)
			return reconcile.Result{}, err
		}
	} else {
		targetSFCluster.SetName(clusterInstance.GetName())
		targetSFCluster.SetNamespace(clusterInstance.GetNamespace())
		targetSFCluster.SetLabels(clusterInstance.GetLabels())
		// copy spec
		clusterInstance.Spec.DeepCopyInto(&targetSFCluster.Spec)
		log.Info("Updating SFCluster in target cluster", "Cluster", clusterID)
		err = targetClient.Update(context.TODO(), targetSFCluster)
		if err != nil {
			log.Error(err, "Error occurred while updating sfcluster provisioner", "clusterId", clusterID)
			return reconcile.Result{}, err
		}
	}

	// Creating/Updating kubeconfig secret for sfcluster in target cluster
	clusterInstanceSecret := &corev1.Secret{}
	err = r.Get(context.TODO(), types.NamespacedName{Name: clusterInstance.Spec.SecretRef, Namespace: namespace}, clusterInstanceSecret)
	if err != nil {
		log.Error(err, "Failed to get be kubeconfig secret for sfcluster...", "clusterId", request.NamespacedName.Name, "kubeconfig-secret", clusterInstance.Spec.SecretRef)
		return reconcile.Result{}, err
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
	err = targetClient.Update(context.TODO(), targetSFClusterSecret)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			log.Info("kubeconfig secret for sfcluster in target cluster not found, Creating...", "clusterId", clusterID)
			err = targetClient.Create(context.TODO(), targetSFClusterSecret)
			if err != nil {
				log.Error(err, "Error occurred while creating kubeconfig secret for sfcluster in target cluster", "clusterId", clusterID)
				return reconcile.Result{}, err
			}
		} else {
			log.Error(err, "Error occurred while updating kubeconfig secret for sfcluster in target cluster", "clusterId", clusterID)
			return reconcile.Result{}, err
		}
	}

	// Create Statefulset in target cluster for provisioner
	provisionerInstance := &appsv1.StatefulSet{}
	provisionerInstance.SetName(statefulSetInstance.GetName())
	provisionerInstance.SetNamespace(statefulSetInstance.GetNamespace())
	provisionerInstance.SetLabels(statefulSetInstance.GetLabels())
	// copy spec
	statefulSetInstance.Spec.DeepCopyInto(&provisionerInstance.Spec)
	// set replicaCount to 1
	replicaCount := int32(1)
	provisionerInstance.Spec.Replicas = &replicaCount

	// set env CLUSTER_ID for containers
	for i := range provisionerInstance.Spec.Template.Spec.Containers {
		clusterIDEnv := &corev1.EnvVar{
			Name:  constants.OwnClusterIDEnvKey,
			Value: clusterID,
		}
		provisionerInstance.Spec.Template.Spec.Containers[i].Env = append(provisionerInstance.Spec.Template.Spec.Containers[i].Env, *clusterIDEnv)
	}

	log.Info("Updating provisioner", "Cluster", clusterID)
	err = targetClient.Update(context.TODO(), provisionerInstance)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			log.Info("Provisioner not found, Creating...", "clusterId", clusterID)
			err = targetClient.Create(context.TODO(), provisionerInstance)
			if err != nil {
				log.Error(err, "Error occurred while creating provisioner", "clusterId", clusterID)
				return reconcile.Result{}, err
			}
		} else {
			log.Error(err, "Error occurred while updating provisioner", "clusterId", clusterID)
			return reconcile.Result{}, err
		}
	}

	// Deploy cluster rolebinding
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
	log.Info("Updating clusterRole", "clusterId", clusterID)
	err = targetClient.Update(context.TODO(), clusterRoleBinding)
	if err != nil {
		if apiErrors.IsNotFound(err) {
			log.Info("ClusterRoleBinding not found, creating role binding", "clusterId", clusterID)
			err = targetClient.Create(context.TODO(), clusterRoleBinding)
			if err != nil {
				log.Error(err, "Error occurred while creating ClusterRoleBinding", "clusterId", clusterID)
				return reconcile.Result{}, err
			}
			return reconcile.Result{}, nil
		}
		log.Error(err, "Error occurred while updating ClusterRoleBinding", "clusterId", clusterID)
		return reconcile.Result{}, err
	}

	return reconcile.Result{}, nil
}
