# Operator APIs
These APIs are provided to perform various operations tasks like getting summary of deployments or trigger updates of deployments etc.

## Fetching Hostname for Operator API calls
For executing the REST APIs mentioned below, hostname is needed.
To fetch the hostname of the operator-api app, execute the following commmand:
```shell
kubectl get ingress -n interoperator
```
And pick the hostname corresponding to "interoperator-op-apis-service-ingress" resource

## Contents
1. [/operator/deployments/{deployment-id}](#operatordeploymentsdeployment-id)

      1. [GET](#get): Summary of single deployment
  
      2. [PATCH](#patch): Trigger update of single deployment
  
2. [/operator/deployments](#operatordeployments)

     1. [GET](#get-1): Summary of batch of deployments
  
     2. [PATCH](#patch-1): Trigger update for batch of deployment

## /operator/deployments/{deployment-id}

### GET
#### Description

Get summary of single deployment. Specify deployment using deployment-id. (Other identifiers like deployment name are not supported)

#### Parameters

| Name | Type | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ---- |
| deployment-id | path | ID for the deployment to be fetched | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success response |
| 401 | Returned when incorrect basic auth credentials are used |

#### Security

Basic authentication is supported

#### Examples
**Request**
```shell
GET https://<operator-apis-ingress-host>/operator/deployments/21d94798-e29e-4635-a5a6-4b0db0494bcd
```

**Response**
```shell
Response Code: 200

Response Body:
{
  "id": "21d94798-e29e-4635-a5a6-4b0db0494bcd",
  "serviceId": "24731fb8-7b84-5f57-914f-d3d55d793dd4",
  "planId": "29d7d4c8-6fe2-4c2a-a5ca-b826937d5a88",
  "context": {
    "clusterid": "36470de7-1031-4b91-a437-2c955379bf29",
    "instance_name": "demo-postgresql-4",
    "namespace": "default",
    "platform": "kubernetes"
  },
  "clusterId": "1",
  "status": {
    "state": "succeeded",
    "description": ""
  }
}
```

### PATCH
#### Description

Trigger update of single deployment. Specify deployment using deployment-id. (Other identifiers like deployment name are not supported)

#### Parameters

| Name | Type | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ---- |
| deployment-id | path | ID for the deployment to be fetched | Yes | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success response |
| 401 | Returned when incorrect basic auth credentials are used |

#### Security

Basic authentication is supported

#### Examples
**Request**
```shell
PATCH https://<operator-apis-ingress-host>/operator/deployments/21d94798-e29e-4635-a5a6-4b0db0494bcd
```

**Response**
```shell
Reponse Code: 200

Response Body:

Update for 21d94798-e29e-4635-a5a6-4b0db0494bcd was successfully triggered
```

## /operator/deployments

### GET
#### Description

Get summary of batch of deployments. Specify batch using service and plan query params. Pagination support is provided.

#### Parameters

| Name | Type | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ---- |
| service | query | Instances with this service ID will be fetched | No | string |
| nextPageToken | query | This is returned by server in `nextPageUrl` in response body. Arbitrary values other than provided by server are not supported | No | string |
| pageSize | query | Response will contain summary of at most `pageSize` deployments | No | string |
| plan | query | Instances with this plan ID will be fetched. `service` and `plan` combination should be valid. | No | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success response |
| 401 | Returned when incorrect basic auth credentials are used |

#### Security

Basic authentication is supported

#### Examples
**Request**
```shell
GET https://<operator-apis-ingress-host>/operator/deployments?service=24731fb8-7b84-5f57-914f-d3d55d793dd4&plan=29d7d4c8-6fe2-4c2a-a5ca-b826937d5a88&pageSize=2
```
**Response**
```shell
Response Code: 200

Response Body:
{
    "totalDeployments": 5,
    "totalDeploymentsOnPage": 2,
    "pageSize": 2,
    "nextPageURL": "/operator/deployments?nextPageToken=<some-token-from-server>&pageSize=2&plan=29d7d4c8-6fe2-4c2a-a5ca-b826937d5a88&service=24731fb8-7b84-5f57-914f-d3d55d793dd4",
    "deployments": [
        {
            "id": "21d94798-e29e-4635-a5a6-4b0db0494bcd",
            "serviceId": "24731fb8-7b84-5f57-914f-d3d55d793dd4",
            "planId": "29d7d4c8-6fe2-4c2a-a5ca-b826937d5a88",
            "context": {
                "clusterid": "36470de7-1031-4b91-a437-2c955379bf29",
                "instance_name": "demo-postgresql-4",
                "namespace": "default",
                "platform": "kubernetes"
            },
            "clusterId": "1",
            "status": {
                "state": "succeeded",
                "description": ""
            }
        },
        {
            "id": "27d28ec8-8098-44af-a219-2df067942c17",
            "serviceId": "24731fb8-7b84-5f57-914f-d3d55d793dd4",
            "planId": "29d7d4c8-6fe2-4c2a-a5ca-b826937d5a88",
            "context": {
                "clusterid": "36470de7-1031-4b91-a437-2c955379bf29",
                "instance_name": "demo-postgresql-1",
                "namespace": "default",
                "platform": "kubernetes"
            },
            "clusterId": "1",
            "status": {
                "state": "succeeded",
                "description": ""
            }
        }
    ]
}
```
**Note**: All the query parameters above are optional. Please see below points regarding them:
1. If none of them are provided, summary of all the deployments is returned. In other words, there's no default value supported for any of these parameters.
2. For pagination support, [features of ApiServer](https://kubernetes.io/docs/reference/using-api/api-concepts/#retrieving-large-results-sets-in-chunks) are used. No state maintained at Operator APIs application.

### PATCH
#### Description

Trigger update of batch of deployments. Specify batch using service and plan query params. Note that the updates are triggered separately in a parallel process, and response is returned before all the upgrades are actually triggered. This is done to avoid the request timeout and rate limit issues in case of large batch size. Deployment summary APIs described above can be used to validate the result of this operation. 

#### Parameters

| Name | Type | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ---- |
| service | query | Instances with this service ID will be updated. | No | string |
| plan | query | Instances with this plan ID will be updated. `service` and `plan` combination should be valid. | No | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success response |
| 401 | Returned when incorrect basic auth credentials are used |

#### Security

Basic authentication is supported

#### Examples
**Request**
```shell
PATCH https://<operator-apis-ingress-host>/operator/deployments?service=24731fb8-7b84-5f57-914f-d3d55d793dd4&plan=29d7d4c8-6fe2-4c2a-a5ca-b826937d5a88
```

**Response**
```shell
Response Code: 200

Response Body:
Triggering update for 5 instances
```

## Logging  

In operator-apis we are using `zap` (i.e. sigs.k8s.io/controller-runtime/pkg/log/zap) plugin for logging. The log level, stacktrace level and output format can be changed/configured from [values.yaml](../helm-charts/interoperator/values.yaml).
* values.operator_apis.log_level : To set log level. Allowed values are 'info', 'error', 'debug' or any integer value > 0 (i.e. 1 or 2 or 3).  
* values.operator_apis.log_output_format : Log Output format or Encoder. Allowed values are 'json' or 'console'.  
* values.operator_apis.log_stacktrace_level : Allowed values are 'info', 'error' or 'panic'.  
