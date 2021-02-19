# Upgrade Interoperator from the earlier releases(special handling, downtime if any)

If no special handling is required, to upgrade to a newer version use
```shell
helm --namespace interoperator upgrade -i --wait --set cluster.host=sf.ingress.< clusterdomain > --version < version > interoperator interoperator-charts/interoperator
```
This assumes interoperator is deployed in namespace `interoperator` with release name `interoperator` and the interoperator helm repo is added as `interoperator-charts`.

## Table of Content
- [Upgrade Interoperator from the earlier releases(special handling, downtime if any)](#upgrade-interoperator-from-the-earlier-releasesspecial-handling-downtime-if-any)
  - [Table of Content](#table-of-content)
  - [Special handling for specific version upgrades](#special-handling-for-specific-version-upgrades)
    - [0.6.0 -> 0.7.0](#060---070)
      - [Upgrade to 0.7.0 using some other helm version](#upgrade-to-070-using-some-other-helm-version)
    - [0.4.0 or 0.4.1 -> 0.4.2](#040-or-041---042)
    - [0.3.0 -> 0.4.0/0.4.1](#030---040041)
    - [Local clone to 0.3.0](#local-clone-to-030)

## Special handling for specific version upgrades

### 0.6.0 -> 0.7.0
For this upgrade helm version `v3.1.0` must be used. 
```shell
$ helm version # version must be v3.1.0
version.BuildInfo{Version:"v3.1.0", GitCommit:"b29d20baf09943e134c2fa5e1e1cab3bf93315fa", GitTreeState:"clean", GoVersion:"go1.13.7"}

$ helm --namespace interoperator upgrade -i --force --wait --set cluster.host=sf.ingress.< clusterdomain > --version 0.7.0 interoperator interoperator-charts/interoperator
```

If any other version of helm is used, the existing service instances might get deleted.

#### Upgrade to 0.7.0 using some other helm version
This is not recommended. But if it is not possible to use helm `v3.1.0` for this upgrade, use the following instructions
```shell
$ helm version # version != v3.1.0
version.BuildInfo{Version:"v3.2.0", GitCommit:"e11b7ce3b12db2941e90399e874513fbd24bcb71", GitTreeState:"clean", GoVersion:"go1.14.2"}

$ helm -n interoperator ls # deployed interoperator version is 0.6.0
NAME         	NAMESPACE    	REVISION	UPDATED                                	STATUS  	CHART              	APP VERSION
interoperator	interoperator	1       	2020-05-20 10:46:09.593066047 +0530 IST	deployed	interoperator-0.6.0	0.6.0

$ # Delete the existing kubernetes resources except the CustomResourceDefinitions
$ helm -n interoperator template --version 0.7.0 interoperator interoperator-charts/interoperator | kubectl -n interoperator delete -f -

$ # Get the secret which stores the release info for the interoperator deployment
$ kubectl -n interoperator get secrets -l "owner=helm"
NAME                                  TYPE                 DATA   AGE
sh.helm.release.v1.interoperator.v1   helm.sh/release.v1   1      7m13s

$ # Delete the release info for the interoperator deployment
$ kubectl -n interoperator delete secrets sh.helm.release.v1.interoperator.v1

$ # Deploy interoperator version 0.7.0. Helm treats it as a fresh installation
$ helm -n interoperator upgrade -i --force --wait --set cluster.host=sf.ingress.< clusterdomain > --version 0.7.0 interoperator interoperator-charts/interoperator

Release "interoperator" does not exist. Installing it now.
NAME: interoperator
LAST DEPLOYED: Wed May 20 10:46:09 2020
NAMESPACE: interoperator
STATUS: deployed
REVISION: 1
TEST SUITE: None
```

### 0.4.0 or 0.4.1 -> 0.4.2
First upgrade interoperator using:
```shell
helm upgrade --set cluster.host=sf.ingress.< clusterdomain > --namespace interoperator --version 0.4.2 interoperator interoperator-charts/interoperator --force --recreate-pods
```

Then on each sister cluster delete the `provisioner` statefulset.
```shell
kubectl -n interoperator delete statefulset provisioner --ignore-not-found
```

### 0.3.0 -> 0.4.0/0.4.1

To add service fabrik interoperator helm chart repo if not already added
```shell
helm repo add interoperator-charts https://cloudfoundry-incubator.github.io/service-fabrik-broker/helm-charts
helm repo update
```

To update to 0.4.0 version
```shell
kubectl delete ClusterRoleBinding interoperator-interoperator-manager-rolebinding
kubectl delete ClusterRole interoperator-interoperator-manager-role

# Assuming interoperator is currently deployed in interoperator namespace
kubectl -n interoperator delete ConfigMap interoperator-config

# Assuming current helm release name is interoperator 
helm upgrade --set cluster.host=sf.ingress.< clusterdomain > --namespace interoperator --version 0.4.0 interoperator interoperator-charts/interoperator --force --recreate-pods
```
Once the ClusterRole is deleted the existing deployment stops working and there is downtime till helm upgrade is completed.

### Local clone to 0.3.0

To add service fabrik interoperator helm chart repo if not already added
```shell
helm repo add interoperator-charts https://cloudfoundry-incubator.github.io/service-fabrik-broker/helm-charts
helm repo update
```

To update to 0.3.0 version
```shell
helm upgrade --set cluster.host=sf.ingress.< clusterdomain > --namespace interoperator --version 0.3.0 interoperator interoperator-charts/interoperator --force --recreate-pods
```
