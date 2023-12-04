package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	authenticationv1alpha1 "github.com/gardener/gardener/pkg/apis/authentication/v1alpha1"
	gardencorev1beta1 "github.com/gardener/gardener/pkg/apis/core/v1beta1"
	"github.com/gardener/gardener/pkg/client/kubernetes"

	"k8s.io/apimachinery/pkg/types"

	corev1 "k8s.io/api/core/v1"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	cl "sigs.k8s.io/controller-runtime/pkg/client"
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

func getUpdatedSecret(secret_name string, secret_namespace string) error {
	err := ms_cl.Get(context.Background(), cl.ObjectKey{
		Name:      secret_name,
		Namespace: secret_namespace,
	}, updated_sec)
	return err
}

func updateShootSecret() error {
	err := ms_cl.Update(ctx, updated_sec)
	return err
}

func Retry(maxRetries int, sleep time.Duration, operation RetryableOperation) error {
	for attempt := 1; attempt <= maxRetries; attempt++ {
		err := operation()
		if err == nil {
			return nil
		}
		time.Sleep(sleep * time.Duration(attempt))
	}

	return errors.New("Exhausted all attempts")
}

func main() {

	maxRetries := 3
	retryInterval := 30 * time.Second
	err := Retry(maxRetries, retryInterval, func() error {
		var err error
		in_cluster_config, err = getInClusterConfig()
		return err
	})
	if err != nil {
		fmt.Println("Failed to fetch in-cluster config: ", err)
		os.Exit(1)
	} else {
		fmt.Println("Fetched the in-cluster config.")
	}

	ms_cl, err = cl.New(in_cluster_config, cl.Options{})
	if err != nil {
		fmt.Println("Failed to create client of mastercluster.")
		os.Exit(1)
	}

	ctx = context.Background()

	err = Retry(maxRetries, retryInterval, func() error {
		return getServiceAccountKubeconfigSecret()
	})
	if err != nil {
		fmt.Println("Failed in fetching service-account-kubeconfig secret", err)
		os.Exit(1)
	} else {
		fmt.Println("Fetched the service-account-kubeconfig secret.")
	}

	sa_config, err := clientcmd.RESTConfigFromKubeConfig(sa_sec.Data["kubeconfig"])
	if err != nil {
		fmt.Println("Error in getting service account REST Config from kubeconfig.")
		os.Exit(1)
	}

	sa_cl, err = cl.New(sa_config, cl.Options{Scheme: kubernetes.GardenScheme})
	if err != nil {
		fmt.Println("Failed to create service account client.")
		os.Exit(1)
	}

	err = Retry(maxRetries, retryInterval, func() error {
		return getSecretList()
	})
	if err != nil {
		fmt.Println("Failed in fetching secret list", err)
		os.Exit(1)
	} else {
		fmt.Println("Fetched the secret list")
	}

	expiration := 1440 * time.Minute
	expirationSeconds := int64(expiration.Seconds())

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
				fmt.Println("Failed in fetching shoot cluster ", shoot_name, ": ", err)
				os.Exit(1)
			} else {
				fmt.Println("Fetched the shoot cluster ", shoot_name)
			}

			err = Retry(maxRetries, retryInterval, func() error {
				return createAdminKubeConfig()
			})
			if err != nil {
				fmt.Println("Failed in creating adminkubeconfig of ", shoot_name, " cluster: ", err)
				os.Exit(1)
			} else {
				fmt.Println("Created adminkubeconfig of ", shoot_name, " cluster.")
			}

			shoot_kubeconfig := adminKubeconfigRequest.Status.Kubeconfig
			updated_sec = &corev1.Secret{}
			err = Retry(maxRetries, retryInterval, func() error {
				return getUpdatedSecret(secret.Name, secret.Namespace)
			})
			if err != nil {
				fmt.Println("Failed in fetching updated secret of ", shoot_name, " cluster: ", err)
				os.Exit(1)
			} else {
				fmt.Println("Fetched updated secret of ", shoot_name, " cluster.")
			}

			updated_sec.Data["kubeconfig"] = shoot_kubeconfig

			err = Retry(maxRetries, retryInterval, func() error {
				return updateShootSecret()
			})
			if err != nil {
				fmt.Println("Failed in updating the existing secret for the ", shoot_name, " cluster: ", err)
				os.Exit(1)
			} else {
				fmt.Println("Updated the existing secret of the  ", shoot_name, " cluster.")
			}

		}
	}

}
