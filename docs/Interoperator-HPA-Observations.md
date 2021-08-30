# Interoperator HPA Observations

##  Abstract

This document describes HPA, it's implementation details for 'interoperator-broker' and the various tests that were performed to derive the desired recommendations. 

## Table of Content
- [Interoperator HPA Observations](#interoperator-hpa-observations)
  - [Abstract](#abstract)
  - [Table of Content](#table-of-content)
  - [Context](#context)
  - [Load Testing](#load-testing)
    - [Load test without auto-scaling](#load-test-without-auto-scaling)
    - [Load test with auto-scaling using the HPA](#load-test-with-auto-scaling-using-the-hpa)

## Context

The Horizontal Pod Autoscaler automatically scales the number of the pods, depending on resource utilization like CPU. For example, if we target a 50% CPU utilization for the pods but the pods have an 80% CPU utilization, the hpa will automatically create new pods. If the CPU utilization falls below 50%, for example, 30%, the hpa terminates pods. This ensures that we always run enough pods but also helps to not waste resources by running too many pods.
Besides CPU utilization, you can also use custom metrics to scale. These custom metrics can be, for example, response time, queue length, or hits-per-second.

In the hpa, you can configure the minimum and maximum amount of pods. This prevents the hpa from creating new pods (until you run out of resources) when your application goes haywire but also ensures a bottom line to guarantee high-availability. 
The Horizontal Pod Autoscaler checks by default the metrics every 15 seconds.

## Load Testing

We worked with 3 variables - RPM, requests count and Target CPU utilization
RPM -               Requests per minute
Requests count -    Total number of requests
CPU threshold -     Maximum CPU utilization before scaling the pods.

Locust is used for the load testing with a customized locust.py file to fulfill the requirements. Each request maps to one of the following API calls:
 - provision an instance
 - create binding
 - get a binding
 - get an instance
The ratio of these calls used for the testing was 1:25:30:20 respectively.

### Load test without auto-scaling
When the test was conducted without using HPA, we observed multiple connection errors like below, in the broker logs and the requests were throttled:

```
Unable to connect to the server: dial tcp 35.241.197.242:443: connect: operation timed out
```


### Load test with auto-scaling using the HPA

The testing was performed with the default values of the various flags supported by HPA.

Requests count | RPM | Broker Target CPU utilization(%) | Min Replicas | Max Replicas | Max CPU Utilization(%) | Provisioning call count |  Create Binding Call Count | Get Binding call count | Get provisioning call count | Get catalog call count | Comments
--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---
300 | 60 | 30 | 2 | 5 | 56 | 29 | 271
300 | 180 | 30 | 2 | 5 | 78 | 36 | 264
300 | 300 | 30 | 2 | 6 | 69 | 32 | 268
500 | 240 | 30 | 2 | 4 | 47 | 52 | 448
500 | 300 | 30 | 2 | 6 | 85 | 45 | 453
300 | 300 | 50 | 2 | 4 | 81 | 29 | 271
500 | 300 | 50 | 2 | 3 | 68 | 63 | 437
500 | 420 | 50 | 2 | 4 | 80 | 58 | 442
4500 | 300 | 30 | 2 | 6 | 79 | 55 | 1739 | 1208 | 1498 | 11 | worker nodes CPU was increased to 16 to handle the load
4500 | 300 | 50 | 2 | 2 | 36 | 59 | 1829 | 1199 | 1462 | 11 | worker nodes CPU was increased to 16 to handle the load
4500 | 300 | 50 | 2 | 2 | 47 | 48 | 1852 | 1198 | 1402 | 11 | worker nodes CPU was increased to 32 to handle the load
4500 | 300 | 70 | 2 | 2 | 15 | 470 | 1723 | 1176 | 1528 | 30 | worker nodes CPU was increased to 32 to handle the load

Following tests were performed after enabling quota_app. The cpu utilization for broker with quota_app enabled, was similar to the previous tests conducted without enabling quota_app.

Requests count | RPM | Quota_App Target CPU utilization(%) | Min Replicas | Max Replicas | Max CPU Utilization(%) | Provisioning call count |  Create Binding Call Count | Get Binding call count | Get provisioning call count | Get catalog call count | Comments
--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---
4500 | 300 | 70 | 2 | 4 | 117 | 4500 | 0 | 0 | 0 | 30 | worker nodes CPU was increased to 32 to handle the load
4500 | 300 | 70 | 2 | 2 | 3 | 52 | 1173 | 1188 | 1526 | 30 | worker nodes CPU was increased to 32 to handle the load

Even with the increased CPU of 32 for the worker nodes, some "gateway timeout" errors were observed from the nginx:

```
html>
<head><title>502 Bad Gateway</title></head>
<body>
<center><h1>502 Bad Gateway</h1></center>
<hr><center>nginx</center>
</body>
</html>
, code=502
```