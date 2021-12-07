# Support of kubeconfig rotation of clusters
## Single cluster Interoperator deployment
In this deployment, primary cluster is also be the sister cluster where service instances get provisioned.
Here we use in-cluster kubeconfig provided inside the pod by Kubernetes. As a result, kubeconfig rotation of the primary cluster doesn't affect the service fabrik operations.


##Multi cluster Interoperator deployment
In this deployment, we will have a primary cluster and one or more sister clusters. Service instances are provisioned in the sister cluster(s). Kubeconfig rotation of the primary cluster doesn't affect the service fabrik operations. But kubeconfig rotation of sister cluster will affect service fabrik operations.
To restore the service fabrik operations the new kubeconfig of the sister cluster needs to be updated in primary cluster.

Follow these steps to update kubeconfig of sister cluster in primary cluster :
* Initiate rotation the kubeconfig of sister cluster from Gardener 
* Copy the newly generated kubeconfig of the cluster 
* In primary cluster, update the kubeconfig as base64 encoded string in the secret (which is used in sfcluster CR)
```shell
apiVersion: v1
kind: Secret 
data:
    kubeconfig: <base64 encoded kubeconfig of the cluster>
```
To edit the cluster secret:
```
kubectl -n interoperator edit secret $(kubectl get sfcluster <sister-cluster-name> -n interoperator -o json | jq -r '.spec.secretRef')
```
####Note:
* All sync binding operations will fail once the kubeconfig rotation is started until sfcluster secret gets updated in the primary cluster with the new kubeconfig.
* All new async operations will not progress as rotation disrupt the replication of sfserviceinstance/binding into/from the sister cluster. But the operations will be restored after the kubeconfig secret get updated.
