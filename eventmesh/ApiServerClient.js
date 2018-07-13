'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const assert = require('assert');
const config = require('../common/config');
const logger = require('../common/logger');
const CONST = require('../common/constants');
const kc = require('kubernetes-client');
const JSONStream = require('json-stream');
const errors = require('../common/errors');
const BadRequest = errors.BadRequest;
const NotFound = errors.NotFound;
const Conflict = errors.Conflict;
const InternalServerError = errors.InternalServerError;

const apiserver = new kc.Client({
  config: {
    url: `https://${config.internal.ip}:${CONST.APISERVER.PORT}`,
    insecureSkipTlsVerify: true
  },
  version: CONST.APISERVER.VERSION
});

function buildErrors(err) {
  let throwErr;
  switch (err.code) {
  case CONST.HTTP_STATUS_CODE.BAD_REQUEST:
    throwErr = new BadRequest(err.message);
    break;
  case CONST.HTTP_STATUS_CODE.NOT_FOUND:
    throwErr = new NotFound(err.message);
    break;
  case CONST.HTTP_STATUS_CODE.CONFLICT:
    throwErr = new Conflict(err.message);
    break;
  default:
    throwErr = new InternalServerError(err.message);
    break;
  }
  throw throwErr;
}

class ApiServerClient {

  constructor() {
    this.ready = false;
  }

  init() {
    return Promise.try(() => {
      if (!this.ready) {
        return apiserver.loadSpec()
          .then(() => {
            this.ready = true;
            logger.info('Loaded Successfully');
          });
      }
    });
  }

  /**
   * @description Register watcher for (resourceGroup , resourceType)
   * @param {string} resourceGroup - Name of the resource
   * @param {string} resourceType - Type of the resource
   * @param {string} callback - Fucntion to call when event is received
   */
  registerWatcher(resourceGroup, resourceType, callback, queryString) {
    return Promise.try(() => this.init())
      .then(() => {
        const stream = apiserver
          .apis[`${resourceGroup}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
          .watch.namespaces(CONST.APISERVER.NAMESPACE)[resourceType].getStream({
            qs: {
              labelSelector: queryString ? queryString : ''
            }
          });
        const jsonStream = new JSONStream();
        stream.pipe(jsonStream);
        jsonStream.on('data', callback);
        jsonStream.on('error', err => {
          logger.error('Error occured during watching', err);
          this.registerWatcher(resourceGroup, resourceType, callback, queryString);
          //throw err;
        });
        return stream;
      })
      .catch(err => {
        return buildErrors(err);
      });
  }

  parseResourceDetailsFromSelfLink(selfLink) {
    // self links are typically: /apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/d-7
    const resourceType = _.split(selfLink, '/')[6];
    const resourceGroup = _.split(_.split(selfLink, '/')[2], '.')[0];
    return {
      resourceGroup: resourceGroup,
      resourceType: resourceType
    };
  }

  _createResource(resourceGroup, resourceType, body) {
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[`${resourceGroup}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType].post({
          body: body
        }));
  }

  createLock(lockType, body) {
    return this._createResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, lockType, body)
      .catch(err => {
        return buildErrors(err);
      });
  }

  deleteResource(resourceGroup, resourceType, resourceId) {
    return Promise.try(() => this.init())
      .then(() => apiserver.apis[`${resourceGroup}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId).delete());
  }

  patchResource(resourceGroup, resourceType, resourceId, delta) {
    return Promise.try(() => this.init())
      .then(() => apiserver.apis[`${resourceGroup}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId).patch({
          body: delta
        }));
  }

  deleteLock(resourceType, resourceId) {
    return this.deleteResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, resourceType, resourceId)
      .catch(err => {
        return buildErrors(err);
      });
  }

  updateResource(resourceGroup, resourceType, resourceId, delta) {
    return this.patchResource(resourceGroup, resourceType, resourceId, delta)
      .catch(err => {
        return buildErrors(err);
      });
  }

  getLockDetails(resourceType, resourceId) {
    return Promise.try(() => this.init())
      .then(() => apiserver.apis[`${CONST.APISERVER.RESOURCE_GROUPS.LOCK}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId).get())
      .then(resource => {
        return JSON.parse(resource.body.spec.options);
      })
      .catch(err => {
        return buildErrors(err);
      });
  }

  getResource(resourceGroup, resourceType, resourceId) {
    return Promise.try(() => this.init())
      .then(() => apiserver.apis[`${resourceGroup}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId).get())
      .catch(err => {
        return buildErrors(err);
      });
  }

  createDeployment(resourceId, val) {
    const opts = {
      operationId: resourceId,
      resourceId: resourceId,
      operationName: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      operationType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
      value: val
    };
    return this.createOperation(opts);
  }

  _updateResourceState(resourceType, resourceId, stateValue) {
    const opts = {
      operationId: resourceId,
      resourceId: resourceId,
      operationName: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      operationType: resourceType,
      stateValue: stateValue
    };
    return this.updateOperationState(opts);
  }

  getResourceState(resourceType, resourceId) {
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[`${CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId)
        .get())
      .then(json => json.body.status.state)
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @description Create Resource in Apiserver with the opts
   * @param {string} opts.resourceId - Unique id of resource
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   * @param {Object} opts.value - Value to set for spec.options field of resource
   */
  createOperation(opts) {
    const resourceBody = {
      metadata: {
        'name': `${opts.operationId}`,
        'labels': {
          instance_guid: `${opts.resourceId}`,
        },
      },
      spec: {
        'options': JSON.stringify(opts.value)
      },
    };
    logger.info(`Creating resource ${resourceBody.metadata.name} with options:`, opts.value);
    const statusJson = {
      status: {
        state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
        lastOperation: 'created',
        response: JSON.stringify({})
      }
    };
    return this._createResource(opts.operationName, opts.operationType, resourceBody)
      .then(() => apiserver.apis[`${opts.operationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.operationType](opts.operationId).status.patch({
          body: statusJson
        }))
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @description Function to patch the response filed with opts.value
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   * @param {Object} opts.value - Object to merge with the existing Result object
   */
  patchOperationResponse(opts) {
    logger.info('Patching Operation with :', opts);
    return this.getOperationResponse(opts)
      .then(res => {
        logger.info(`Patching ${res} with ${opts.value}`);
        opts.value = _.merge(res, opts.value);
        return this.updateOperationResponse(opts);
      });
  }

  /**
   * @description Function to update the response field
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   * @param {Object} opts.value - Object to be set as status.response
   */
  updateOperationResponse(opts) {
    logger.info('Updating Operation Result with :', opts);
    const patchedResource = {
      'status': {
        'response': JSON.stringify(opts.value),
      }
    };
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[`${opts.operationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.operationType](opts.operationId)
        .status.patch({
          body: patchedResource
        }))
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @description Function to Update the state field
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   * @param {Object} opts.stateValue - Value to set as state
   */
  updateOperationState(opts) {
    logger.info('Updating Operation State with :', opts);
    assert.ok(opts.operationName, `Property 'operationName' is required to update operation state`);
    assert.ok(opts.operationType, `Property 'operationType' is required to update operation state`);
    assert.ok(opts.operationId, `Property 'operationId' is required to update operation state`);
    assert.ok(opts.stateValue, `Property 'stateValue' is required to update operation state`);
    const patchedResource = {
      'status': {
        'state': opts.stateValue
      }
    };
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[`${opts.operationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.operationType](opts.operationId)
        .status.patch({
          body: patchedResource
        }))
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @description Function to Update the state field
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   * @param {Object} opts.response - Object to be set as response
   * @param {string} opts.stateValue - Value to set as state
   */
  updateOperationStateAndResponse(opts) {
    logger.info('Updating Operation status with :', opts);
    const patchedResource = {
      'status': {
        'state': opts.stateValue,
        'response': JSON.stringify(opts.response)
      }
    };
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[`${opts.operationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.operationType](opts.operationId)
        .status.patch({
          body: patchedResource
        }))
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @description Update Last Operation to opts.value for resource
   * @param {string} opts.resourceId - Unique id of resource
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {Object} opts.value - Unique if of the last operation
   */
  updateLastOperation(opts) {
    const patchedResource = {};
    patchedResource.metadata = {};
    patchedResource.metadata.labels = {};
    patchedResource.metadata.labels[`last_${opts.operationName}_${opts.operationType}`] = opts.value;
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[`${CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[CONST.APISERVER.RESOURCE_TYPES.DIRECTOR](opts.resourceId)
        .patch({
          body: patchedResource
        }))
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @description Gets Last Operation
   * @param {string} opts.resourceId - Unique id of resource
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   */
  getLastOperation(opts) {
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[`${CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[CONST.APISERVER.RESOURCE_TYPES.DIRECTOR](opts.resourceId)
        .get())
      .then(json => json.body.metadata.labels[`last_${opts.operationName}_${opts.operationType}`])
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @description Patch Operation Options
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   * @param {Object} opts.value
   */
  patchOperationOptions(opts) {
    return this.getOperationOptions(opts)
      .then(res => {
        logger.info(`Patching ${res} with ${opts.value}`);
        opts.value = _.merge(res, opts.value);
        return this.updateOperationOptions(opts);
      });
  }

  /**
   * @description Update Operation Options
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   * @param {Object} opts.value
   */
  updateOperationOptions(opts) {
    logger.info('Updating resource with options:', opts.value);
    const change = {
      spec: {
        'options': JSON.stringify(opts.value)
      },
    };
    return this.patchResource(opts.operationName, opts.operationType, opts.operationId, change)
      .catch(err => {
        return buildErrors(err);
      });
  }
  /**
   * @description Get Operation Options
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   */
  getOperationOptions(opts) {
    assert.ok(opts.operationName, `Property 'operationName' is required to get operation state`);
    assert.ok(opts.operationType, `Property 'operationType' is required to get operation state`);
    assert.ok(opts.operationId, `Property 'operationId' is required to get operation state`);
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[`${opts.operationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.operationType](opts.operationId)
        .get())
      .then(json => JSON.parse(json.body.spec.options))
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @description Get Operation State
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   */
  getOperationState(opts) {
    assert.ok(opts.operationName, `Property 'operationName' is required to get operation state`);
    assert.ok(opts.operationType, `Property 'operationType' is required to get operation state`);
    assert.ok(opts.operationId, `Property 'operationId' is required to get operation state`);
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[`${opts.operationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.operationType](opts.operationId)
        .get())
      .then(json => json.body.status.state)
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @description Get Operation Response
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   */
  getOperationResponse(opts) {
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[`${opts.operationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.operationType](opts.operationId)
        .get())
      .then(json => JSON.parse(json.body.status.response))
      .catch(err => {
        return buildErrors(err);
      });
  }

}

module.exports = ApiServerClient;