# Service Fabrik Inter-operator Cluster Landscape Architecture

##  Abstract

This document describes the cluster landscape aspect of the architecture and scope of the Service Fabrik inter-operator.
This includes not only the architectural approach to handle the different possible cluster landscapes but also the details about the different landscape scenarions (such as a dedicated v/s shared cluster landscape) and also some rationale for the landscape scenarios as well as the way they influence the architectural approach.

## Target Audience

Architects, Developers, Product Owners, Development Managers who are interested in understanding/using Service Fabrik's inter-operator to expose Kubernetes-based services as [OSB](https://www.openservicebrokerapi.org/)-compliant service brokers and integrate with [Service Manager](https://github.com/Peripli/service-manager).

## Table of Content
* [Service Fabrik Inter\-operator Cluster Landscape Architecture](#service-fabrik-inter-operator-cluster-landscape-architecture)
  * [Abstract](#abstract)
  * [Target Audience](#target-audience)
  * [Table of Content](#table-of-content)
  * [Context](#context)
  * [Cluster Landscape Scenarios](#cluster-landscape-scenarios)
    * [Dedicated Service Fabrik Inter\-operator](#dedicated-service-fabrik-inter-operator)
      * [A simple dedicated landscape scenario](#a-simple-dedicated-landscape-scenario)
        * [Pros](#pros)
        * [Cons](#cons)
      * [A conservative dedicated landscape scenario](#a-conservative-dedicated-landscape-scenario)
        * [Pros](#pros-1)
        * [Cons](#cons-1)
      * [An optimal dedicated landscape scenario](#an-optimal-dedicated-landscape-scenario)
        * [Pros](#pros-2)
        * [Cons](#cons-2)
    * [Shared Service Fabrik Inter\-operator](#shared-service-fabrik-inter-operator)
      * [A simple shared landscape scenario](#a-simple-shared-landscape-scenario)
        * [Pros](#pros-3)
        * [Cons](#cons-3)
      * [A conservative shared landscape scenario](#a-conservative-shared-landscape-scenario)
        * [Pros](#pros-4)
        * [Cons](#cons-4)
      * [An optimal shared landscape scenario](#an-optimal-shared-landscape-scenario)
        * [Pros](#pros-5)
        * [Cons](#cons-5)
    * [Hybrid Landscape Scenario](#hybrid-landscape-scenario)
        * [Pros](#pros-6)
        * [Cons](#cons-6)
    * [Recommended Landscape Scenario](#recommended-landscape-scenario)
  * [Managing the Cluster Landscape](#managing-the-cluster-landscape)
    * [An analogy to kube\-scheduler](#an-analogy-to-kube-scheduler)
    * [Service Instance Scheduling](#service-instance-scheduling)
    * [A point to note about Service Instance Scheduling](#a-point-to-note-about-service-instance-scheduling)

## Context

The [context](basic.md#context) mentioned in the [basic architecture](basic.md) is applicable here.

In addition to the above context, continuing the [operator design-pattern](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#high-level-design-pattern) in Kubernetes, the individual service operators are expected to manage the service instances within a kubernetes cluster.
This leaves the responsibility for setting up and managing the landscape of Kubernetes clusters where the individual service operators provision and manage their services instances out of the scope of the individual service operators.

## Cluster Landscape Scenarios

### Dedicated Service Fabrik Inter-operator

In this scenario, an individual service operator would provision and configure a dedicated Service Fabrik inter-operator for its own purposes of integrating its landscape of service instances on Kubernetes clusters via the [Service Manager](https://github.com/Peripli/service-manager).

#### A simple dedicated landscape scenario

A simple scenario for a dedicated inter-operator could be depicted as below.
![A Simple Dedicated Landscape](images/dedicated-landscape-simple.png).

* Each service gets its own dedicated Kubernetes cluster to host its service operator and its service instances.
* Each service provisions and configured its own instance of Service Fabrik inter-operator. This is in the same cluster where the service operator and the service instances are hosted.
* The different dedicated Service Fabrik Brokers for the different individual services are registered with the Service Manager.

##### Pros
* The landscape is simple.
* Better isolation between different kinds of services.
* The Kubernetes cluster is dedicated for the individual service and its instances.
  * Less operational overhead.
  * The cluster can be tuned and configured to be optimal for the needs of the service and its instances.
* The Service Fabrik inter-operator is dedicated for the individual service and its instances.
  * Less operation overhead.
  * The inter-operator can be configured to be optimal for the needs of the service and its instances.

##### Cons
* Service instances are still running on a single Kubernetes cluster.
  * Service implementation and the cluster configuration must be strengthened to ensure good isolation from the perspective of both [security](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#security) and [performance](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#performance).
* Scale is coupled to the scale of the host Kubernetes cluster.
  * There are limits to the size of workable Kubernetes clusters and this size limit will, in turn, limit the number and scale of the service instances hosted on that cluster.

#### A conservative dedicated landscape scenario

As one way of addressing the isolation [issues](#cons) in the [simple landscape scenario](#a-simple-dedicated-landscape-scenario), one can think of a conservative landscape as depicted below.

![A Conservative Dedicated Landscape](images/dedicated-landscape-conservative.png).

##### Pros

* Service instancares are running in a dedicated Kubernetes cluster. This reduces the isolation concerns from the security and performance perspective.
* The number of service instances per landscape as well as the scale of the individual service instances is not limited by the architecture and the landscape.
* The Kubernetes cluster is dedicated for the individual service and its instances.
  * Moderate operational overhead.
  * The clusters can be tuned and configured to be optimal for the needs of the service and its instances.
* The Service Fabrik inter-operator is dedicated for the individual service and its instances.
  * Less operation overhead.
  * The inter-operator can be configured to be optimal for the needs of the service and its instances.

##### Cons

* The cluster landscape is more complex.
* Mapping of a service instance to its hosting Kubernetes Cluster is one-to-one.
* Sub-optimal resource utilization. Kubernetes control-plane becomes an overhead for each service instance.
* The number of Kubernetes cluster in the landscape becomes very large, requiring further keeping track and management of those Kubernetes clusters.

#### An optimal dedicated landscape scenario

Due to the [limitations](#cons) of the [simple landscape scenario](#a-simple-dedicated-landscape-scenario) as well as [those](#cons-1) of the [conservative landscape scenario]((#a-conservative-dedicated-landscape-scenario), one can think of a more optimal landscape as depicted below.

![An Optimal Dedicated Landscape](images/dedicated-landscape-optimal.png).

##### Pros

* More optimal resource-utilization. Many service instances are hosted on any given Kubernetes cluster. This distributes the usage of the Kubernetes control-plane across multiple service instances.
* The number of service instances in the landscape as well as the scale of the individual service instances is not limited by the architecture and the landscape.
* The Kubernetes clusters are dedicated for the individual service and its instances.
  * Moderate operational overhead.
  * The clusters can be tuned and configured to be optimal for the needs of the service and its instances.
* The Service Fabrik inter-operator is dedicated for the individual service and its instances.
  * Less operation overhead.
  * The inter-operator can be configured to be optimal for the needs of the service and its instances.

##### Cons

* The cluster landscape is more complex.
* Mapping of a service instance to its hosting Kubernetes Cluster is many-to-many.
* Multiple service instances are still running in any given Kubernetes cluster.
  * Service implementation and the cluster configuration must be strengthened to ensure good isolation from the perspective of both [security](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#security) and [performance](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#performance).

### Shared Service Fabrik Inter-operator

In this scenario, an individual service operator would use and configure a Service Fabrik inter-operator that is shared with other services for integrating its landscape of service instances on Kubernetes clusters via the [Service Manager](https://github.com/Peripli/service-manager).

#### A simple shared landscape scenario

A simple scenario for a shared inter-operator could be depicted as below.
![A Simple Shared Landscape](images/shared-landscape-simple.png).

* A single Kubernetes cluster might host the service operator and service instances of multiple services.
* A single instance of Service Fabrik inter-operator might be shared by multiple services.
* Each service will configure the same Service Fabrik inter-operator for its own purpose of integrating its landscape of service instances on Kubernetes clusters via the [Service Manager](https://github.com/Peripli/service-manager).
This is in the same cluster where the service operator and the service instances are hosted.
* The Service Fabrik Broker that is shared between the different individual services is registered with the Service Manager.

##### Pros
* The landscape is simple.
* The isolation between different kinds of services is pretty much the same as between the different instances of the same service.

##### Cons
* The Kubernetes cluster is shared for multiple services and their instances.
  * More operational overhead as it is difficult to co-ordinate between teams managing the different services.
  * It is difficult to tune the cluster and configure it to be optimal for the needs of the different service and their instances.
* The Service Fabrik inter-operator is shared between the different services and their instances.
  * More operational overhead.
* Service instances are running on a single Kubernetes cluster.
  * Service implementation and the cluster configuration must be strengthened to ensure good isolation from the perspective of both [security](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#security) and [performance](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#performance).
* Scale is coupled to the scale of the host Kubernetes cluster.
  * There are limits to the size of workable Kubernetes clusters and this size limit will, in turn, limit the number and scale of the service instances hosted on that cluster.

#### A conservative shared landscape scenario

As one way of addressing the isolation [issues](#cons-3) in the [simple landscape scenario](#a-simple-shared-landscape-scenario), one can think of a conservative landscape as depicted below.

![A Conservative Dedicated Landscape](images/shared-landscape-conservative.png).

##### Pros

* Service instances are running in a dedicated Kubernetes cluster. This reduces the isolation concerns from the security and performance perspective.
* The number of service instances per landscape as well as the scale of the individual service instances is not limited by the architecture and the landscape.
* The Kubernetes cluster is dedicated for the individual service instances.
  * Moderate operational overhead.
  * The clusters can be tuned and configured to be optimal for the needs of the service and its instances.

##### Cons

* The cluster landscape is more complex.
* Mapping of a service instance to its hosting Kubernetes Cluster is one-to-one.
* The Service Fabrik inter-operator is shared between the different services and their instances.
  * More operational overhead.
* Sub-optimal resource utilization. Kubernetes control-plane becomes an overhead for each service instance.
* The number of Kubernetes cluster in the landscape becomes very large, requiring further keeping track and management of those Kubernetes clusters.

#### An optimal shared landscape scenario

Due to the [limitations](#cons-3) of the [simple landscape scenario](#a-simple-shared-landscape-scenario) as well as [those](#cons-4) of the [conservative landscape scenario]((#a-conservative-landscape-scenario), one can think of a more optimal landscape as depicted below.

![An Optimal Shared Landscape](images/shared-landscape-optimal.png).

##### Pros

* More optimal resource-utilization. Many service instances are hosted on any given Kubernetes cluster. This distributes the usage of the Kubernetes control-plane across multiple service instances.
* The number of service instances in the landscape as well as the scale of the individual service instances is not limited by the architecture and the landscape.

##### Cons

* The cluster landscape is more complex.
* The Kubernetes clusters are shared among multiple services and their instances.
  * More operational overhead as it is difficult to co-ordinate between teams managing the different services.
  * It is difficult to tune the clusters and configure them to be optimal for the needs of the different service and their instances.
* The Service Fabrik inter-operator is shared between the different services and their instances.
  * More operational overhead.
* Mapping of a service instance to its hosting Kubernetes Cluster is many-to-many.
* Multiple service instances are still running in any given Kubernetes cluster.
  * Service implementation and the cluster configuration must be strengthened to ensure good isolation from the perspective of both [security](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#security) and [performance](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#performance).

### Hybrid Landscape Scenario

Due to the [limitations](#cons-5) of the [optimal shared landscape scenario](#an-optimal-shared-landscape-scenario), a modified version of the [optimal dedicated landscape scenario](#an-optimal-dedicated-landscape-scenario) can be considered as depicted below.

![An Optimal Hybrid Landscape](images/hybrid-landscape-optimal.png).

Here, the Service Fabrik instance is shared but the Kubernetes clusters are dedicated for the individual services.

##### Pros

* More optimal resource-utilization. Many service instances are hosted on any given Kubernetes cluster. This distributes the usage of the Kubernetes control-plane across multiple service instances.
* The number of service instances in the landscape as well as the scale of the individual service instances is not limited by the architecture and the landscape.
* The Kubernetes clusters are dedicated for the individual service and its instances.
  * Moderate operational overhead.
  * The clusters can be tuned and configured to be optimal for the needs of the service and its instances.

##### Cons

* The cluster landscape is more complex.
* The Service Fabrik inter-operator is shared between the different services and their instances.
  * More operational overhead.
* Mapping of a service instance to its hosting Kubernetes Cluster is many-to-many.
* Multiple service instances are still running in any given Kubernetes cluster.
  * Service implementation and the cluster configuration must be strengthened to ensure good isolation from the perspective of both [security](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#security) and [performance](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#performance).

### Three Dimensions for Comparison

#### One Cluster vs. Multiple Clusters

In this axis, we can compare the different cluster landscape scenarios based on whether there will be only one Kubernetes cluster hosting all the services in a landscape or there will be multiple Kubernetes clusters per landscape.

| One Cluster | Multiple Clusters |
|---|---|
|<ul><li>[Simple dedicated](#a-simple-dedicated-landscape-scenario)</li><li>[Simple shared](#a-simple-shared-landscape-scenario) |<ul><li>[Conservative dedicated](#a-conervative-dedicated-landscape-scenario)</li><li>[Conservative shared](#a-conservative-shared-landscape-scenario)

#### Dedicated Clusters vs. Shared Clusters

#### Isolation

### Recommended Landscape Scenario

Based on the evaluation of the different scenarios, the [optimal dedicated landscape scenario](#an-optimal-dedicated-landscape-scenario) or the [optimal hybrid landscape scenaro](#hybrid-landscape-scenaro) seem to be most suitable for the most common use-cases.

This is mainly because of the following reasons.
* The [simple](cluster-landscape.md#a-simple-dedicated-landscape-scenario) [scenarios](cluster-landscape.md#a-simple-shared-landscape-scenario) are constrained in scaling the individual service instances as well as the number of service instances by the scale of the hosting Kubernetes cluster.
* The [conservative](cluster-landscape.md#a-conservative-dedicated-landscape-scenario) [scenarios](cluster-landscape.md#a-conservative-shared-landscape-scenario) lead to sub-optimal resource usage lead to an unnecessary proliferation of Kubernetes clusters (one per service instance).

The [optimal](cluster-landscape.md#an-optimal-dedicated-landscape-scenario) [landscape](cluster-landscape.md#an-optimal-shared-landscape-scenario) [scenarios](cluster-landscape.md#hybrid-landscape-scenario) address both of these concerns by supporting both the following functionality.

* Arbitrary (potentially, dynamic) number of Kubernetes clusters to host the service instances of the individual services.
* Multiple services instances hosted on any given Kubernetes cluster.

The security and isolation issues due to the hosting of multiple service instances on any given Kubernetes cluster can be mitigated using the [security](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#security) and [performance](https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/README.md#performance) guidelines.

Among the [optimal](cluster-landscape.md#an-optimal-dedicated-landscape-scenario) [landscape](cluster-landscape.md#an-optimal-shared-landscape-scenario) [scenarios](cluster-landscape.md#hybrid-landscape-scenario), the [dedicated](#an-optimal-dedicated-landscape-scenario) and the [hybrid](#hybrid-landscape-scenaro) landscape scenarios are preferred to the [shared](#an-optimal-shared-landscape-scenaro) landscape scenario.
This is because of the operational overhead and difficulty of tuning a shared set of Kubernetes clusters for the needs of the individual services and their service instances.

## Managing the Cluster Landscape

The more complex optimal cluster landscape (be it for the [dedicated](#an-optimal-dedicated-landscape-scenario) or [shared](#an-optimal-shared-landscape-scenario) scenarios) will require some way to manage the landscape of multiple clusters as well as manage the problem of mapping a service instance of any given service to a Kubernetes cluster where it is hosted. 

### An analogy to kube-scheduler

In Kubernetes, the [`kube-scheduler`](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/) performs a role that is analogous to the problem of mapping a service instance to a Kubernets cluster.

1. A [pod](https://kubernetes.io/docs/concepts/workloads/pods/pod-overview/) gets created in the [`kube-apiserver`](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/).
This could be directly (via [`kubectl`](https://kubernetes.io/docs/reference/kubectl/overview/) or the [Kubernetes API](https://kubernetes.io/docs/concepts/overview/kubernetes-api/)).
Or it could be indirectly (via some other high-order concepts such as [`replicasets`](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/) or other [controllers]((https://github.wdf.sap.corp/CPonK8s/k8s-native-services-concept/blob/master/building-blocks.md#custom-controller)).
1. The [`kube-scheduler`](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/) detects that there is a `pod` to be scheduled, inspects the resources requirements of the `pod` and tries to identify the right Kubernetes [`node`](https://kubernetes.io/docs/concepts/architecture/nodes/) where this `pod` can be scheduled.
The [`kube-scheduler`](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/) updates the `pod` specification with the information about the `node` where it is to be scheduled.
1. The [`kubelet`](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/) running inside the designated `node` detects the new `pod` that is scheduled to be executed in that particular `node` and triggers the `pod` execution.

These steps can be depicted as shown below.

![Pod Scheduling Control-flow](images/pod-scheduling.png)

There main advantages of this approach are as follows.
* The scheduling decision is captured explicitly in the `pod` resource itself.
* The complexity of the decision-making process for picking the most suitable `node` is completely decoupled from the more mundane matter of actually executing the `pod` once the suitable `node` has been selected.
* Schedulers are decoupled from the vagaries of actual details of `pod` executions.
They can be simpler and can concentrate only on the details about the scheduling algorithm.
This makes writing custom schedulers easier.
* Custom schedulers or even multiple schedulers can co-exist in the same Kubernetes-cluster, increasing the power of the decoupling described above.

### Service Instance Scheduling

Analogous to the [`pod` scheduling control-flow](#an-analogy-to-kube-scheduler), we can think of *scheduling* service instances of the different services on the most suitable Kubernetes clusters for those instances.

The analogous steps would be as follows.

1. A [`ServiceInstance`](basic.md#sfserviceinstance) is created in the `kube-apiserver` of the Service Fabrik inter-operator.
Typically, this would be the eventual result of a [`provision`](basic.md#provision) call to the [Service Fabrik Broker](basic.md#service-fabrik-broker), which, in its turn, would be an eventual result of a `provision` call to the [Service Manager](https://github.com/Peripli/service-manager).
1. A `ServiceInstance` scheduler detects that there is a new `ServiceInstance` that needs to be scheduled, inspects the resource requirements of the `ServiceInstance` and tries to identify the right Kubernetes cluster where the `ServiceInstance` can be scheduled.
The `ServiceInstance` scheduler updates the `ServiceInstance` specification with the information about the Kubernetes cluster where the `ServiceInstance` is to be scheduled.
1. The [Service Fabrik inter-operator](basic.md#service-fabrik-inter-operator) provisions the `ServiceInstance` in the specified Kubernetes cluster.

These steps can be depicted as shown below.

![Service Instance Scheduling Control-flow](images/serviceinstance-scheduling.png)

There main advantages of this approach are as follows.
* The scheduling decision is captured explicitly in the `ServiceInstance` resource itself.
  * All the information about the `ServiceInstance` is located in the resource itself.
  This makes it possible to implement the rescheduling of `ServiceInstances` to some other Kubernetes cluster in the future.
* The complexity of the decision-making process for picking the most suitable Kubernetes cluster is completely decoupled from the more mundane matter of actually provisioning the `ServiceInstance` once the suitable Kubernetes cluster been selected.
* Schedulers are decoupled from the vagaries of actual details of provisioning of `serviceinstances`.
They can be simpler and can concentrate only on the details about the scheduling algorithm.
This makes writing custom schedulers easier.
* Custom schedulers or even multiple schedulers can co-exist in the same Service Fabrik landscape, increasing the power of the decoupling described above.
* Using either multi-variable scheduling or multiple custom schedulers (or a combination of such approaches) and combining it with the [cluster landscape autoscaler](cluster-landscape-autoscaling.md#cluster-landscape-autoscaling) all the scenarios mentioned [above](#cluster-landscape-scenarios) can be supported.

### A point to note about Service Instance Scheduling

In the [`pod` scheduling analogy](#an-analogy-to-kube-scheduler), the up-to-date set of available Kubernetes [`nodes`](https://kubernetes.io/docs/concepts/architecture/nodes/) in the Kubernetes cluster is assumed to be present and its members known to both the [`kube-scheduler`](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-scheduler/) as well as the individual [`kubelets`](https://kubernetes.io/docs/reference/command-line-tools-reference/kubelet/) running in those `nodes`.
In Kubernetes, this information is available and kept up-to-date in the form of the [`Node`](https://kubernetes.io/docs/concepts/architecture/nodes/) resource.

Similarly, in the case of [`ServiceInstance` scheduling](#serviceinstance-scheduling), the up-to-date set of available Kubernetes clusters in the landscape is assumed to be present and its members (the individual Kubernetes clusters) are known to both the `ServiceInstance` scheduler and the [Service Fabrik inter-operator](basic.md#service-fabrik-inter-operator).
There is no standard Kubernetes resource that captures this information.

The [Cluster Registry](https://github.com/kubernetes/cluster-registry/) defines the the [`Cluster`](https://github.com/kubernetes/cluster-registry/blob/master/cluster-registry-crd.yaml) resource that can capture the basic information about the available Kubernetes clusters.
But schedulers might need more information to make scheduling decisions.
Some of the information might be obtained by making a call to the actual [`kube-apiserver`](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/) of the target Kubernetes clusters.
Also, some additional mechanism would be required to keep the Cluster Registry up-to-date with the actual cluster landscape.