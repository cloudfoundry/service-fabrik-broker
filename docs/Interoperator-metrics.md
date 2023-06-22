# Metrics

Interoperator exposes prometheus endpoints from `multiclusterdeployer`, `scheduler` and `provisioner` components. These are exposed via `<release-name>-multiclusterdeployer-metrics-service`, `<release-name>-scheduler-metrics-service` and `<release-name>-controller-manager-metrics-service` kubernetes services. The metric endpoint can be reached at `<service>:8443/metrics`. If prometheus is configured to scrape from services, it will automatically scrape all these metrics. More info about metrics exposed can be found in [kubebuilder docs](https://book.kubebuilder.io/reference/metrics.html).

In addition the to the metrics provided by kubebuilder, the some additional custom metric are also provided.

## Custom Metrics
### Multiclusterdeployer
Metric | Labels | Description
--- | --- | ---
interoperator_cluster_up| cluster | State of the clusters.<br> 0 - down <br> 1 - up
interoperator_service_instances_state | instance_id | State of the service instance.<br> 0 - succeeded <br> 1 - failed <br> 2 - in progress <br> 3 - in_queue/update/delete <br> 4 - gone
interoperator_cluster_service_instances | cluster | Number of service instances partitioned by cluster
interoperator_cluster_allocatable | cluster <br> type | Allocatable resources partitioned by cluster and resource type
interoperator_service_bindings_state | binding_id <br> instance_id | State of the service binding.<br> 0 - succeeded <br> 1 - failed <br> 2 - in progress <br> 3 - in_queue/update/delete <br> 4 - gone

From Interoperator release v0.25.1 there are 2 new controllers added to push metrics for service instance and binding calls.  
The 2 new controllers are  
* sfserviceinstancemetrics
* sfservicebindingmetrics

Details of new metrics from these 2 new controllers are describe below  

Metric | Labels | Description
--- | --- | ---
interoperator_service_instances_metrics_state | instance_id <br> state <br> creation_timestamp <br> deletion_timestamp <br> service_id <br> plan_id <br> org_guid <br> space_guid <br> namespace <br> last_operation | State of the service instance.<br> 0 - succeeded <br> 1 - failed <br> 2 - in progress <br> 3 - in_queue/update/delete <br> 4 - gone
interoperator_service_bindings_metrics_state | binding_id <br> instance_id <br> state <br> creation_timestamp <br> deletion_timestamp <br> namespace | State of the service binding.<br> 0 - succeeded <br> 1 - failed <br> 2 - in progress <br> 3 - in_queue/update/delete <br> 4 - gone


## Liveness and Readiness Probe
The metrics endpoints are exposed regardless of the status of leader election. So the metrics endpoint is used as liveness and readiness probe for the pods. If the metric endpoint is not up, liveness probe will fail and kubernetes will restart the pod.

## Developer Docs

### Adding additional metrics
An example for adding custom metric can be found in pull request [#983](https://github.com/cloudfoundry-incubator/service-fabrik-broker/pull/983). To expose a custom metric from a controller:
* Declare a prometheus [Collector](https://godoc.org/github.com/prometheus/client_golang/prometheus#Collector) as a global variable in the controller. The list of supported collectors can be found in [prometheus client docs](https://godoc.org/github.com/prometheus/client_golang/prometheus).
* In `SetupWithManager` section of the controller, register the `collector` with the prometheus [Registry](https://godoc.org/sigs.k8s.io/controller-runtime/pkg/metrics) using the `metrics.Registry.MustRegister()` function. `MustRegister()` accepts variable number of arguments and all the `collectors` can be registered together. Import the `"sigs.k8s.io/controller-runtime/pkg/metrics"` package to access the global `Registry`.
* Anywhere in the reconcile loop, update the metric.

### Sample PromQL queries:
Query | Output | Comment
--- | ---- | --- |
interoperator_service_bindings_state | interoperator_service_bindings_state{binding_id="0abc2107-de86-408d-8617-800935b84028", instance_id="80ca2362b-6561-4673-ad24-111d7ac86cfd"} 1 <br> interoperator_service_bindings_state{binding_id="0abc2107-de86-408d-8617-800935b84038", instance_id="80ca2362b-6561-4673-ad24-111d7ac86cfd"} 1 <br> interoperator_service_bindings_state{binding_id="0ceb2107-de86-408d-8617-800935b84108", instance_id="65ca2362b-6561-4673-ad24-111d7ac86cfd"} 0 <br> interoperator_service_bindings_state{binding_id="1abc2107-de86-408d-8617-800935b84038", instance_id="81ca2362b-6561-4673-ad24-111d7ac86cfd"} 0 | List all the bindings present in the cluster
sum by (instance_id) (interoperator_service_bindings_state) | {instance_id="81ca2362b-6561-4673-ad24-111d7ac86cfd"} 0 <br> {instance_id="80ca2362b-6561-4673-ad24-111d7ac86cfd"} 2 <br> {instance_id="65ca2362b-6561-4673-ad24-111d7ac86cfd"} 0 | List all the bindings grouped by the instance id
count(count by (binding_id) (interoperator_service_bindings_state)) | 	4 | List the count of all the bindings in the cluster
count(count by (binding_id) (interoperator_service_bindings_state == 1)) | 4 | List all the failed bindings in the cluster


## Grafana Dashboard
The metrics exported to prometheus can be imported in grafana using the grafana data source for prometheus. A sample grafana dashboard is provided [here](./grafana.json). 

### Alerting
Alerts can be configured from [grafana](https://grafana.com/docs/grafana/latest/alerting/create-alerts/). The sample dashboard has alerts configured when the total allocatable `cpu` and `memory` of all clusters falls belows a threshold. Grafana supports various [notification channels](https://grafana.com/docs/grafana/latest/alerting/notifications/). To use the alerts from the sample dashboard configure a notification channel first.
