package main

import (
	"context"
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

var serviceAccountKubeconfigSecret *corev1.Secret = &corev1.Secret{}
var secretList *corev1.SecretList = &corev1.SecretList{}
var shoot *gardencorev1beta1.Shoot = &gardencorev1beta1.Shoot{}
var primaryClusterClient cl.Client
var serviceAccountClient cl.Client
var ctx context.Context
var adminKubeconfigRequest *authenticationv1alpha1.AdminKubeconfigRequest = &authenticationv1alpha1.AdminKubeconfigRequest{}
var updatedSecret *corev1.Secret = &corev1.Secret{}
var in_cluster_config *rest.Config
var cronjobLog logr.Logger

// Fetching the In-Cluster Config for accessing cluster's resources
func getInClusterConfig() (*rest.Config, error) {
	in_cluster_config, err := rest.InClusterConfig()
	return in_cluster_config, err
}

type RetryableOperation func() error

// Getting the Service Account Kubeconfig Secret resource using the primary cluster client
func getServiceAccountKubeconfigSecret() error {
	err := primaryClusterClient.Get(context.Background(), cl.ObjectKey{
		Name:      "service-account-kubeconfig",
		Namespace: os.Getenv("NAMESPACE"),
	}, serviceAccountKubeconfigSecret)
	return err
}

// Fetching the Secret list from the primary cluster using the primary cluster client
func getSecretList() error {
	err := primaryClusterClient.List(ctx, secretList)
	return err
}

// Fetching the shoot cluster resource using the Gardener service account client.
func getShootCluster(shoot_namespace string, shoot_name string) error {
	err := serviceAccountClient.Get(ctx, types.NamespacedName{Namespace: shoot_namespace, Name: shoot_name}, shoot)
	return err
}

// Creating the admin kubeconfig for the specified shoot cluster.
func createAdminKubeConfig() error {
	err := serviceAccountClient.SubResource("adminkubeconfig").Create(ctx, shoot, adminKubeconfigRequest)
	return err
}

// updating the shoot secret with the new kubeconfig in the primary cluster
func updateShootSecret(secret_name string, secret_namespace string) error {
	err1 := primaryClusterClient.Get(context.Background(), cl.ObjectKey{
		Name:      secret_name,
		Namespace: secret_namespace,
	}, updatedSecret)
	if err1 != nil {
		return err1
	}
	shoot_kubeconfig := adminKubeconfigRequest.Status.Kubeconfig
	updatedSecret.Data["kubeconfig"] = shoot_kubeconfig
	err2 := primaryClusterClient.Update(ctx, updatedSecret)
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

func returnError(err error, errorMessage string) {
	cronjobLog.Error(err, errorMessage, "message", "Kubeconfig rotation cronjob failed.")
	os.Exit(1)
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
		returnError(err, "Failed to fetch in-cluster config.")
	}
	cronjobLog.Info("Fetched the in-cluster config.")

	primaryClusterClient, err = cl.New(in_cluster_config, cl.Options{})
	if err != nil {
		returnError(err, "Failed to create client of primarycluster")
	}

	ctx = context.Background()

	err = Retry(maxRetries, retryInterval, func() error {
		return getServiceAccountKubeconfigSecret()
	})
	if err != nil {
		returnError(err, "Failed in fetching service-account-kubeconfig secret.")
	}
	cronjobLog.Info("Fetched the service-account-kubeconfig secret.")

	serviceAccountConfig, err := clientcmd.RESTConfigFromKubeConfig(serviceAccountKubeconfigSecret.Data["kubeconfig"])
	if err != nil {
		returnError(err, "Error in getting service account REST Config from kubeconfig.")
	}

	serviceAccountClient, err = cl.New(serviceAccountConfig, cl.Options{Scheme: kubernetes.GardenScheme})
	if err != nil {
		returnError(err, "Failed to create service account client.")
	}

	err = Retry(maxRetries, retryInterval, func() error {
		return getSecretList()
	})
	if err != nil {
		returnError(err, "Failed in fetching secret list.")
	}
	cronjobLog.Info("Fetched the secret list")

	expiration := 1440 * time.Minute
	expirationSeconds := int64(expiration.Seconds())
	var allUpdateSuccess bool
	allUpdateSuccess = true
	enteredOnce := false
	for _, secret := range secretList.Items {
		if secret.Labels["type"] == "interoperator-cluster-secret" {
			enteredOnce = enteredOnce || true
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

			updatedSecret = &corev1.Secret{}
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
	if enteredOnce == false {
		cronjobLog.Info("There was no secret with metadata.labels.type=interoperator-cluster-secret")
	}
	if allUpdateSuccess != true {
		cronjobLog.Info("Kubeconfig Rotation Job failed.")
		os.Exit(1)
	}
	cronjobLog.Info("Kubeconfig Rotation Job is successful.")
	os.Exit(0)
}
