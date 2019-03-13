# Service Fabrik 2.0

## How to bring your own provisioner/operator

Basic principle of how a operator can be brought in SF2.0 is depicted in the below picture.

![Missing](https://github.com/cloudfoundry-incubator/service-fabrik-broker/blob/gh-pages/architecture/SF2.0-basics.png?raw=true)

To bring in a new provisioner, one has to bring in their own service and plans as described [here](https://github.com/cloudfoundry-incubator/service-fabrik-broker/blob/gh-pages/inter-operator/architecture/basic.md#service-and-plan-registration). Service Fabrik defines `SFService` and `SFSplans` which are the [CRDs](https://kubernetes.io/docs/tasks/access-kubernetes-api/custom-resources/custom-resource-definitions/) defined by the framework. The structure of these CRDs are well described [here](https://github.com/cloudfoundry-incubator/service-fabrik-broker/blob/gh-pages/inter-operator/architecture/basic.md#service-fabrik-inter-operator-custom-resources).

1. Add your services, similar to [this](https://github.com/cloudfoundry-incubator/service-fabrik-broker/blob/master/broker/config/settings.yml#L525-L550) and 
plans similar to [this](https://github.com/cloudfoundry-incubator/service-fabrik-broker/blob/master/broker/config/settings.yml#L685-L748).

2. Make sure the templates are added properly in the plan metadata, simialr to [this](https://github.com/cloudfoundry-incubator/service-fabrik-broker/blob/master/broker/config/settings.yml#L736-L748).

3. Start your operator and do the following:

   1. Register the CRD with Service Fabrik APIServer.
   2. Start watching on the CRD for state change.
   3. Process create/update/delete depending  on the state change.


## Configs supported by Interoperator
The number of workers for the service instance controller and service binding controller can be configured using a config map. The name of the config map must be `interoperator-config` and the namespace must be `default`. Sample config map is:
```
---
apiVersion: v1
kind: ConfigMap
metadata:
 name: interoperator-config
 namespace: default
data:
 instanceWorkerCount: "5"
 bindingWorkerCount: "10"
```
​
The current supported configs are
* instanceWorkerCount - number of workers for the service instance controller
* bindingWorkerCount - number of workers for the service binding controller. 

If the config map is updated, interoperator must be restarted for the configs like number of workers to take effect.
