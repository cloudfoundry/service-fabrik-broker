# Operator APIs
These APIs are provided to perform various operations tasks like getting summary of deployments or trigger updates of deployments etc.

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
TBD

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
TBD

## /operator/deployments

### GET
#### Description

Get summary of batch of deployments. Specify batch using service and plan query params. Pagination support is provided.

#### Parameters

| Name | Type | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ---- |
| service | query | Instances with this service ID will be fetched | No | string |
| nextPageToken | query | This is returned by server in nextPageUrl. Arbitrary values other than provided by server are not supported | No | string |
| pageSize | query | Response will contain summary of at most 'pageSize' deployments | No | string |
| plan | query | Instances with this plan ID will be fetched. 'service' and 'plan' combination should be valid. | No | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success response |
| 401 | Returned when incorrect basic auth credentials are used |

#### Security

Basic authentication is supported

#### Examples
TBD

### PATCH
#### Description

Trigger update of batch of deployments. Specify batch using service and plan query params

#### Parameters

| Name | Type | Description | Required | Schema |
| ---- | ---------- | ----------- | -------- | ---- |
| service | query |  | No | string |
| plan | query |  | No | string |

#### Responses

| Code | Description |
| ---- | ----------- |
| 200 | Success response |
| 401 | Returned when incorrect basic auth credentials are used |

#### Security

Basic authentication is supported

#### Examples
TBD

