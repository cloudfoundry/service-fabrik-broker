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

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	cl "sigs.k8s.io/controller-runtime/pkg/client"
)

func main() {

	config, err := rest.InClusterConfig()
	if err != nil {
		fmt.Println("unable to fetch in cluster config.")
		panic(err.Error())
	}

	ms_cl, err := cl.New(config, cl.Options{})
	if err != nil {
		fmt.Println("failed to create client of mastercluster")
		os.Exit(1)
	}

	ctx := context.Background()

	sa_sec := &corev1.Secret{}
	err = ms_cl.Get(context.Background(), cl.ObjectKey{
		Name:      "service-account-kubeconfig",
		Namespace: "interoperator",
	}, sa_sec)

	if err != nil {
		fmt.Println("Error in fetching service-account-kubeconfig")
		fmt.Println(err.Error())
	}

	sa_config, err := clientcmd.RESTConfigFromKubeConfig(sa_sec.Data["kubeconfig"])
	if err != nil {
		fmt.Println("Error in getting service account kubeconfig")
		fmt.Println(err.Error())
	}

	sa_cl, err := cl.New(sa_config, cl.Options{Scheme: kubernetes.GardenScheme})
	if err != nil {
		fmt.Println("failed to create service account client")
		fmt.Println(err.Error())
	}

	secList := &corev1.SecretList{}
	err = ms_cl.List(ctx, secList)
	// si := len(secList.Items)
	// fmt.Println("Number of secrets are: ", si)
	// // fmt.Println(si)

	for _, secret := range secList.Items {
		if secret.Labels["type"] == "interoperator-cluster-secret" {
			shoot_name := secret.Labels["shoot"]
			shoot_namespace := secret.Labels["namespace"]

			expiration := 90 * time.Minute
			expirationSeconds := int64(expiration.Seconds())
			adminKubeconfigRequest := &authenticationv1alpha1.AdminKubeconfigRequest{
				Spec: authenticationv1alpha1.AdminKubeconfigRequestSpec{
					ExpirationSeconds: &expirationSeconds,
				},
			}
			shoot := &gardencorev1beta1.Shoot{}
			if err := sa_cl.Get(ctx, types.NamespacedName{Namespace: shoot_namespace, Name: shoot_name}, shoot); err != nil {
				fmt.Println(err.Error())
			}

			err = sa_cl.SubResource("adminkubeconfig").Create(ctx, shoot, adminKubeconfigRequest)
			if err != nil {
				fmt.Println("Error in creating adminkubeconfig for the ", shoot, " cluster.")
				fmt.Println(err.Error())
			}

			shoot_kubeconfig := adminKubeconfigRequest.Status.Kubeconfig
			secret.Data["kubeconfig"] = shoot_kubeconfig

			err := ms_cl.Update(ctx, &secret)
			if err != nil {
				fmt.Println("Secret not updated.")
			}

		}
	}

}
