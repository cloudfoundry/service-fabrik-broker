'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const assert = require('assert');
const config = require('../../common/config');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const kc = require('kubernetes-client');
const JSONStream = require('json-stream');
const errors = require('../../common/errors');
const Timeout = errors.Timeout;
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

function convertToHttpErrorAndThrow(err) {
  let message = err.message;
  if (err.error && err.error.description) {
    message = `${message}. ${err.error.description}`;
  }
  let newErr;
  let code;
  if (err.code) {
    code = err.code;
  } else if (err.status) {
    code = err.status;
  }
  switch (code) {
  case CONST.HTTP_STATUS_CODE.BAD_REQUEST:
    newErr = new BadRequest(message);
    break;
  case CONST.HTTP_STATUS_CODE.NOT_FOUND:
    newErr = new NotFound(message);
    break;
  case CONST.HTTP_STATUS_CODE.CONFLICT:
    newErr = new Conflict(message);
    break;
  case CONST.HTTP_STATUS_CODE.FORBIDDEN:
    newErr = new errors.Forbidden(message);
    break;
  default:
    newErr = new InternalServerError(message);
    break;
  }
  throw newErr;
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
   * Poll for Status until opts.start_state changes
   * @param {object} opts - Object containing options
   * @param {string} opts.operationId - Id of the operation ex. backupGuid
   * @param {string} opts.start_state - start state of the operation ex. in_queue
   * @param {object} opts.started_at - Date object specifying operation start time
   */
  getResourceOperationStatus(opts) {
    logger.info(`Waiting ${CONST.EVENTMESH_POLLER_DELAY} ms to get the operation state`);
    let finalState;
    return Promise.delay(CONST.EVENTMESH_POLLER_DELAY)
      .then(() => this.getOperationState({
        operationName: CONST.OPERATION_TYPE.BACKUP,
        operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        operationId: opts.operationId
      }))
      .then(state => {
        if (state === opts.start_state) {
          return this.getResourceOperationStatus(opts);
        } else if (
          state === CONST.APISERVER.RESOURCE_STATE.FAILED ||
          state === CONST.APISERVER.RESOURCE_STATE.DELETE_FAILED
        ) {
          finalState = state;
          return this.getOperationStatus({
              operationName: CONST.OPERATION_TYPE.BACKUP,
              operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
              operationId: opts.operationId,
            })
            .then(status => {
              if (status.error) {
                const errorResponse = JSON.parse(status.error);
                logger.info('Operation manager reported error', errorResponse);
                return convertToHttpErrorAndThrow(errorResponse);
              }
            });
        } else {
          finalState = state;
          const duration = (new Date() - opts.started_at) / 1000;
          logger.info(`Polling for ${opts.start_state} duration: ${duration} `);
          if (duration > CONST.BACKUP.BACKUP_START_TIMEOUT_IN_SECS) {
            logger.error(`Backup with guid ${opts.operationId} not picked up from the queue`);
            throw new Timeout(`Backup with guid ${opts.operationId} not picked up from the queue`);
          }
          return this.getOperationResponse({
            operationName: CONST.OPERATION_TYPE.BACKUP,
            operationType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
            operationId: opts.operationId,
          });
        }
      })
      .then(result => {
        if (result.state) {
          return result;
        }
        return {
          state: finalState,
          response: result
        };
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
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
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

  patchResourceStatus(resourceGroup, resourceType, resourceId, statusDelta) {
    return Promise.try(() => this.init())
      .then(() => apiserver.apis[`${resourceGroup}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId)
        .status.patch({
          body: statusDelta
        }));
  }

  deleteLock(resourceType, resourceId) {
    return this.deleteResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, resourceType, resourceId)
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  updateResource(resourceGroup, resourceType, resourceId, delta) {
    return this.patchResource(resourceGroup, resourceType, resourceId, delta)
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
      });
  }

  getResource(resourceGroup, resourceType, resourceId) {
    return Promise.try(() => this.init())
      .then(() => apiserver.apis[`${resourceGroup}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId).get())
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
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
        logger.info(`Patching ${JSON.stringify(res)} with ${JSON.stringify(opts.value)}`);
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
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Function to Update the error field
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   * @param {Object} opts.error - Value to set as error
   */
  updateOperationError(opts) {
    const operationStatus = {
      'status': {
        'error': JSON.stringify(opts.error)
      }
    };
    return this.patchResourceStatus(opts.operationName, opts.operationType, opts.operationId, operationStatus)
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
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
        logger.info(`Patching ${JSON.stringify(res)} with ${JSON.stringify(opts.value)}`);
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
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
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
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Get Operation Status
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   */
  getOperationStatus(opts) {
    logger.info('Getting Operation Status with :', opts);
    return this.getResource(opts.operationName, opts.operationType, opts.operationId)
      .then(json => json.body.status)
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Function to Update the status field
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   * @param {string} opts.operationId - Unique id of operation
   * @param {Object} opts.stateValue - Value to set as state
   * @param {Object} opts.error - Value to set as error
   * @param {Object} opts.response - Value to set as error
   */
  updateOperationStatus(opts) {
    logger.info('Updating Operation Status with :', opts);
    const patchedResource = {
      'status': {
        'state': opts.stateValue ? opts.stateValue : '',
        'error': opts.error ? JSON.stringify(opts.error) : '',
        'response': opts.response ? JSON.stringify(opts.response) : '',
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
        return convertToHttpErrorAndThrow(err);
      });
  }

}

module.exports = ApiServerClient;