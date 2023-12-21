package main

import (
	"context"
	"fmt"
	"os"
	"time"

	authenticationv1alpha1 "github.com/gardener/gardener/pkg/apis/authentication/v1alpha1"
	gardencorev1beta1 "github.com/gardener/gardener/pkg/apis/core/v1beta1"
	"github.com/gardener/gardener/pkg/client/kubernetes"

	"k8s.io/apimachinery/pkg/types"

	corev1 "k8s.io/api/core/v1"


	"github.com/go-logr/logr"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	ctrl "sigs.k8s.io/controller-runtime"
	cl "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log/zap"

)

var sa_sec *corev1.Secret = &corev1.Secret{}
var secList *corev1.SecretList = &corev1.SecretList{}
var shoot *gardencorev1beta1.Shoot = &gardencorev1beta1.Shoot{}
var ms_cl cl.Client
var sa_cl cl.Client
var ctx context.Context
var adminKubeconfigRequest *authenticationv1alpha1.AdminKubeconfigRequest = &authenticationv1alpha1.AdminKubeconfigRequest{}
var updated_sec *corev1.Secret = &corev1.Secret{}
var in_cluster_config *rest.Config
var cronjobLog logr.Logger



func getInClusterConfig() (*rest.Config, error) {
	in_cluster_config, err := rest.InClusterConfig()
	return in_cluster_config, err
}

type RetryableOperation func() error

func getServiceAccountKubeconfigSecret() error {
	err := ms_cl.Get(context.Background(), cl.ObjectKey{
		Name:      "service-account-kubeconfig",
		Namespace: os.Getenv("NAMESPACE"),
	}, sa_sec)
	return err
}

func getSecretList() error {
	err := ms_cl.List(ctx, secList)
	return err
}

func getShootCluster(shoot_namespace string, shoot_name string) error {
	err := sa_cl.Get(ctx, types.NamespacedName{Namespace: shoot_namespace, Name: shoot_name}, shoot)
	return err
}

func createAdminKubeConfig() error {
	err := sa_cl.SubResource("adminkubeconfig").Create(ctx, shoot, adminKubeconfigRequest)
	return err
}

func updateShootSecret(secret_name string, secret_namespace string) error {
	err1 := ms_cl.Get(context.Background(), cl.ObjectKey{
		Name:      secret_name,
		Namespace: secret_namespace,
	}, updated_sec)
	if err1 != nil {
		return err1
	}
	shoot_kubeconfig := adminKubeconfigRequest.Status.Kubeconfig
	updated_sec.Data["kubeconfig"] = shoot_kubeconfig
	err2 := ms_cl.Update(ctx, updated_sec)
	return err2
}

func Retry(maxRetries int, sleep time.Duration, operation RetryableOperation) error {
	var err error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err = operation()
		if err == nil {
			return nil
		}
		cronjobLog.Error(err, "Retrying operation")
		time.Sleep(sleep * time.Duration(attempt))
	}
	return err
}

func main() {

	ctrl.SetLogger(zap.New(zap.UseDevMode(true)))
	cronjobLog = ctrl.Log.WithName("kubeconfig-rotation-cronjob")

	maxRetries := 3
	retryInterval := 20 * time.Second
	err := Retry(maxRetries, retryInterval, func() error {
		var err error
		in_cluster_config, err = getInClusterConfig()
		return err
	})
	if err != nil {

		cronjobLog.Error(err, "Failed to fetch in-cluster config", "message", "Kubeconfig rotation cronjob failed.")
		os.Exit(1)
	}
	cronjobLog.Info("Fetched the in-cluster config.")

	ms_cl, err = cl.New(in_cluster_config, cl.Options{})
	if err != nil {
		cronjobLog.Error(err, "Failed to create client of mastercluster", "message", "Kubeconfig rotation cronjob failed.")
		os.Exit(1)
	}

	ctx = context.Background()

	err = Retry(maxRetries, retryInterval, func() error {
		return getServiceAccountKubeconfigSecret()
	})
	if err != nil {
		cronjobLog.Error(err, "Failed in fetching service-account-kubeconfig secret.", "message", "Kubeconfig rotation cronjob failed.")
		os.Exit(1)
	}
	cronjobLog.Info("Fetched the service-account-kubeconfig secret.")

	sa_config, err := clientcmd.RESTConfigFromKubeConfig(sa_sec.Data["kubeconfig"])
	if err != nil {
		cronjobLog.Error(err, "Error in getting service account REST Config from kubeconfig.", "message", "Kubeconfig rotation cronjob failed.")
		os.Exit(1)
	}

	sa_cl, err = cl.New(sa_config, cl.Options{Scheme: kubernetes.GardenScheme})
	if err != nil {

		cronjobLog.Error(err, "Failed to create service account client.", "message", "Kubeconfig rotation cronjob failed.")
		os.Exit(1)
	}

	err = Retry(maxRetries, retryInterval, func() error {
		return getSecretList()
	})
	if err != nil {

		cronjobLog.Error(err, "Failed in fetching secret list.", "message", "Kubeconfig rotation cronjob failed.")
		os.Exit(1)
	}
	cronjobLog.Info("Fetched the secret list")


	expiration := 1440 * time.Minute
	expirationSeconds := int64(expiration.Seconds())
	var allUpdateSuccess bool
	allUpdateSuccess = true
	for _, secret := range secList.Items {
		if secret.Labels["type"] == "interoperator-cluster-secret" {
			shoot_name := secret.Labels["shoot"]
			shoot_namespace := secret.Labels["namespace"]

			shoot = &gardencorev1beta1.Shoot{}
			adminKubeconfigRequest = &authenticationv1alpha1.AdminKubeconfigRequest{
				Spec: authenticationv1alpha1.AdminKubeconfigRequestSpec{
					ExpirationSeconds: &expirationSeconds,
				},
			}

			err := Retry(maxRetries, retryInterval, func() error {
				return getShootCluster(shoot_namespace, shoot_name)
			})
			if err != nil {

				cronjobLog.Error(err, "Failed in fetching shoot cluster", "shoot_name", shoot_name)
				allUpdateSuccess = allUpdateSuccess && false
			}
			cronjobLog.Info("Fetched the shoot cluster", "shoot_cluster", shoot_name)


			err = Retry(maxRetries, retryInterval, func() error {
				return createAdminKubeConfig()
			})
			if err != nil {

				cronjobLog.Error(err, "Failed in creating adminkubeconfig", "shoot_name", shoot_name)

				allUpdateSuccess = allUpdateSuccess && false
			}
			cronjobLog.Info("Created adminkubeconfig", "shoot_cluster", shoot_name)



			updated_sec = &corev1.Secret{}
			err = Retry(maxRetries, retryInterval, func() error {
				return updateShootSecret(secret.Name, secret.Namespace)
			})
			if err != nil {

				cronjobLog.Error(err, "Failed in updating the existing secret", "shoot_name", shoot_name)
				allUpdateSuccess = allUpdateSuccess && false
			}
			cronjobLog.Info("Updated the existing secret", "shoot_name", shoot_name)


		}
	}
	if allUpdateSuccess != true {
		cronjobLog.Info("Kubeconfig Rotation Job failed.")
		os.Exit(1)
	}
	cronjobLog.Info("Kubeconfig Rotation Job is successful.")
	os.Exit(0)
}
