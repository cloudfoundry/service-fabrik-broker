//go:build multiclusterdeploy
// +build multiclusterdeploy

/*
Copyright 2020 The Service Fabrik Authors.

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

package multiclusterdeploy

import (
	"context"
	"fmt"

	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/constants"
	"github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/errors"

	"encoding/base64"

	corev1 "k8s.io/api/core/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiErrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/util/retry"
	ctrl "sigs.k8s.io/controller-runtime"
	kubernetes "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"
)

// Not adding the constants to constants pkg as these are temporary
const (
	// The name is hardcoded in helm chart
	settingsConfigMapName = "sf-settings-config"
	settingsKey           = "settings.yml"
)

var log = ctrl.Log.WithName("upgrade_hook")

func upgradeHook(kubeConfig *rest.Config, scheme *runtime.Scheme, mapper meta.RESTMapper) error {
	if kubeConfig == nil {
		err := errors.NewInputError("upgradeHook", "kubeConfig", nil)
		log.Error(err, "invalid input")
		return err
	}

	if scheme == nil {
		err := errors.NewInputError("upgradeHook", "scheme", nil)
		log.Error(err, "invalid input")
		return err
	}

	err := apiextensionsv1.SchemeBuilder.AddToScheme(scheme)
	if err != nil {
		return err
	}

	k8sClient, err := kubernetes.New(kubeConfig, kubernetes.Options{
		Scheme: scheme,
		Mapper: mapper,
	})
	if err != nil {
		log.Error(err, "failed to create k8s client")
		return err
	}

	err = upgradeCrds(k8sClient)
	if err != nil {
		return err
	}
	return nil
}

// upgradeCrds fetches the crds from setting yaml and overwrites the crd specs.
// Skips if it is not already present on apiserver.
// This is done to fix mismatch in crd def during helm upgrade,
// when migrating from apiextensions.vibeta1 to apiextensions.v1 for crds
func upgradeCrds(k8sClient kubernetes.Client) error {
	ctx := context.Background()

	configMap := &corev1.ConfigMap{}
	var configMapKey = types.NamespacedName{
		Name:      settingsConfigMapName,
		Namespace: constants.InteroperatorNamespace,
	}

	err := k8sClient.Get(ctx, configMapKey, configMap)
	if err != nil {
		log.Error(err, "failed to fetch settings configmap")
		return err
	}
	settings := make(map[string]interface{})
	err = yaml.Unmarshal([]byte(configMap.Data[settingsKey]), &settings)
	if err != nil {
		log.Error(err, "failed to decode settings yaml")
		return err
	}

	defaults, err := fetchMap(settings, "defaults")
	if err != nil {
		log.Error(err, "failed to get defaults from settings yaml")
		return err
	}

	apiserver, err := fetchMap(defaults, "apiserver")
	if err != nil {
		log.Error(err, "failed to get defaults.apiserver from settings yaml")
		return err
	}

	crds, err := fetchMap(apiserver, "crds")
	if err != nil {
		log.Error(err, "failed to get defaults.apiserver.crds from settings yaml")
		return err
	}

	for key := range crds {
		cr, err := fetchB64String(crds, key)
		if err != nil {
			log.Error(err, "failed to get CRD from defaults.apiserver.crds in settings yaml", "key", key)
			return err
		}
		crdFromSettings := &apiextensionsv1.CustomResourceDefinition{}
		err = yaml.Unmarshal([]byte(cr), crdFromSettings)
		if err != nil {
			log.Error(err, "failed to unmarshal CRD yaml", "key", key)
			return err
		}
		log.Info("Fetched CRD from settings yaml", "name", crdFromSettings.GetName())
		err = updateCrd(k8sClient, crdFromSettings)
		if err != nil {
			return err
		}

	}
	return nil
}

func updateCrd(k8sClient kubernetes.Client, crdFromSettings *apiextensionsv1.CustomResourceDefinition) error {
	ctx := context.Background()
	crdFromServer := &apiextensionsv1.CustomResourceDefinition{}
	err := retry.RetryOnConflict(retry.DefaultRetry, func() error {
		err := k8sClient.Get(ctx, types.NamespacedName{
			Name: crdFromSettings.GetName(),
		}, crdFromServer)
		if err != nil {
			if apiErrors.IsNotFound(err) {
				log.Info("crd not found on master, skipping", "name", crdFromSettings.GetName())
				return nil
			}
			return err
		}
		crdFromSettings.Spec.DeepCopyInto(&crdFromServer.Spec)
		err = k8sClient.Update(ctx, crdFromServer)
		if err != nil {
			return err
		}
		log.Info("Updated CRD in master cluster", "name", crdFromSettings.GetName())
		return nil
	})
	if err != nil {
		log.Error(err, "Error occurred while updating CRD in master cluster", "name", crdFromSettings.GetName())
		return err
	}
	return nil
}

func fetchMap(m map[string]interface{}, key string) (map[string]interface{}, error) {
	obj, ok := m[key]
	if !ok {
		err := fmt.Errorf("failed to get %s from map", key)
		log.Info("Failed to get key from map", "key", key, "m", m)
		return nil, err
	}
	objMap, ok := obj.(map[string]interface{})
	if !ok {
		err := fmt.Errorf("value not of type map for key %s", key)
		log.Info("Failed to cast obj to map", "key", key, "m", m, "obj", obj)
		return nil, err
	}
	return objMap, nil
}

func fetchB64String(m map[string]interface{}, key string) (string, error) {
	obj, ok := m[key]
	if !ok {
		err := fmt.Errorf("failed to get %s from map", key)
		log.Info("Failed to get key from map", "key", key, "m", m)
		return "", err
	}
	objString, ok := obj.(string)
	if !ok {
		err := fmt.Errorf("value not of type string for key %s", key)
		log.Info("Failed to cast obj to string", "key", key, "m", m, "obj", obj)
		return "", err
	}
	res, err := base64.StdEncoding.DecodeString(objString)
	return string(res[:]), err
}
