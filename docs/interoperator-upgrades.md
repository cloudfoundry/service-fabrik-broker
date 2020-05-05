# Upgrade Interoperator from the earlier releases(special handling, downtime if any)

If no special handling is required, to upgrade to a newer version use
```shell
helm upgrade --set cluster.host=sf.ingress.< clusterdomain > --namespace interoperator --version <version> interoperator sf-charts/interoperator --force --recreate-pods
```

## Special handling for specific version upgrades

### Local clone to 0.3.0

To add service fabrik interoperator helm chart repo if not already added
```shell
helm repo add sf-charts https://cloudfoundry-incubator.github.io/service-fabrik-broker/helm-charts
helm repo update
```

To update to 0.3.0 version
```shell
helm upgrade --set cluster.host=sf.ingress.< clusterdomain > --namespace interoperator --version 0.3.0 interoperator sf-charts/interoperator --force --recreate-pods
```


### 0.3.0 -> 0.4.0/0.4.1

To add service fabrik interoperator helm chart repo if not already added
```shell
helm repo add sf-charts https://cloudfoundry-incubator.github.io/service-fabrik-broker/helm-charts
helm repo update
```

To update to 0.4.0 version
```shell
kubectl delete ClusterRoleBinding interoperator-interoperator-manager-rolebinding
kubectl delete ClusterRole interoperator-interoperator-manager-role

# Assuming interoperator is currently deployed in interoperator namespace
kubectl -n interoperator delete ConfigMap interoperator-config

# Assuming current helm release name is interoperator 
helm upgrade --set cluster.host=sf.ingress.< clusterdomain > --namespace interoperator --version 0.4.0 interoperator sf-charts/interoperator --force --recreate-pods
```
Once the ClusterRole is deleted the existing deployment stops working and there is downtime till helm upgrade is completed.

### 0.4.0 or 0.4.1 -> 0.4.2
First upgrade interoperator using:
```shell
helm upgrade --set cluster.host=sf.ingress.< clusterdomain > --namespace interoperator --version 0.4.2 interoperator sf-charts/interoperator --force --recreate-pods
```

Then on each sister cluster delete the `provisioner` statefulset.
```shell
kubectl -n interoperator delete statefulset provisioner --ignore-not-found
```