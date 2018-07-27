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
    url: `https://${config.apiserver.ip}:${config.apiserver.port}`,
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
            logger.info('Successfully loaded ApiServer Spec');
          });
      }
    });
  }
  /**
   * Poll for Status until opts.start_state changes
   * @param {object} opts - Object containing options
   * @param {string} opts.resourceId - Id of the operation ex. backupGuid
   * @param {string} opts.start_state - start state of the operation ex. in_queue
   * @param {object} opts.started_at - Date object specifying operation start time
   */
  getResourceOperationStatus(opts) {
    logger.info(`Waiting ${CONST.EVENTMESH_POLLER_DELAY} ms to get the operation state`);
    let finalState;
    return Promise.delay(CONST.EVENTMESH_POLLER_DELAY)
      .then(() => this.getState({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: opts.resourceId
      }))
      .then(state => {
        if (state === opts.start_state) {
          return this.getResourceOperationStatus(opts);
        } else if (
          state === CONST.APISERVER.RESOURCE_STATE.FAILED ||
          state === CONST.APISERVER.RESOURCE_STATE.DELETE_FAILED
        ) {
          finalState = state;
          return this.getResource({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
              resourceId: opts.resourceId
            })
            .then(response => {
              if (response.status.error) {
                const errorResponse = response.status.error;
                logger.info('Operation manager reported error', errorResponse);
                return convertToHttpErrorAndThrow(errorResponse);
              }
            });
        } else {
          finalState = state;
          const duration = (new Date() - opts.started_at) / 1000;
          logger.info(`Polling for ${opts.start_state} duration: ${duration} `);
          if (duration > CONST.BACKUP.BACKUP_START_TIMEOUT_IN_SECS) {
            logger.error(`Backup with guid ${opts.resourceId} not picked up from the queue`);
            throw new Timeout(`Backup with guid ${opts.resourceId} not picked up from the queue`);
          }
          return this.getResponse({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
            resourceId: opts.resourceId
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
          .apis[resourceGroup][CONST.APISERVER.API_VERSION]
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
    const resourceGroup = _.split(selfLink, '/')[2];
    return {
      resourceGroup: resourceGroup,
      resourceType: resourceType
    };
  }

  /**
   * @description Create Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.parentResourceId - Id of parent resource to be put in label ex: instance_guid
   * @param {Object} opts.options - Value to set for spec.options field of resource
   * @param {string} opts.status - status of the resource
   */
  createResource(opts) {
    logger.info(`Creating resource with opts: `, opts);
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to create resource`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to create resource`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to create resource`);
    assert.ok(opts.options, `Property 'options' is required to create resource`);
    const metadata = {
      name: opts.resourceId
    };
    if (opts.parentResourceId) {
      metadata.labels = {
        instance_guid: opts.parentResourceId
      };
    }
    const resourceBody = {
      metadata: metadata,
      spec: {
        'options': JSON.stringify(opts.options)
      },
    };
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.resourceType].post({
          body: resourceBody
        }))
      .then((resource) => {
        if (opts.status) {
          const statusJson = {};
          _.forEach(opts.status, (val, key) => {
            statusJson[key] = _.isObject(val) ? JSON.stringify(val) : val;
          });
          return Promise.try(() => this.init())
            .then(() => apiserver.apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
              .namespaces(CONST.APISERVER.NAMESPACE)[opts.resourceType](opts.resourceId).status.patch({
                body: {
                  'status': statusJson
                }
              }));
        }
        return resource;
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Update Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.metadata - Metadata of resource
   * @param {Object} opts.options - Value to set for spec.options field of resource
   * @param {string} opts.status - status of the resource
   */
  updateResource(opts) {
    logger.info('Updating resource with opts: ', opts);
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to update resource`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to update resource`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to update resource`);
    return Promise.try(() => {
        if (opts.options || opts.metadata) {
          const patchBody = {};
          if (opts.metadata) {
            patchBody.metadata = opts.metadata;
          }
          if (opts.options) {
            patchBody.spec = {
              'options': JSON.stringify(opts.options)
            };
          }
          return Promise.try(() => this.init())
            .then(() => apiserver
              .apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
              .namespaces(CONST.APISERVER.NAMESPACE)[opts.resourceType](opts.resourceId).patch({
                body: patchBody
              }));
        }
      })
      .then((resource) => {
        if (opts.status) {
          const statusJson = {};
          _.forEach(opts.status, (val, key) => {
            statusJson[key] = _.isObject(val) ? JSON.stringify(val) : val;
          });
          return Promise.try(() => this.init())
            .then(() => apiserver.apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
              .namespaces(CONST.APISERVER.NAMESPACE)[opts.resourceType](opts.resourceId).status.patch({
                body: {
                  'status': statusJson
                }
              }));
        }
        return resource;
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Patch given response fields in status.response
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.response - Value to set for status.response field of resource
   */
  patchResponse(opts) {
    logger.info('Patching resource response with opts: ', opts);
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to patch response`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to patch response`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to patch response`);
    assert.ok(opts.response, `Property 'response' is required to patch response`);
    return this.getResource(opts)
      .then((resource) => {
        const oldResponse = resource.status.response;
        const response = _.merge(oldResponse, opts.response);
        const options = _.chain(opts)
          .omit('response')
          .set('status', {
            'response': response
          })
          .value();
        return this.updateResource(options);
      });
  }

  /**
   * @description Patch given options fields in spec.options
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.options - Value to set for spec.options field of resource
   */

  patchOptions(opts) {
    logger.info('Patching resource options with opts: ', opts);
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to patch options`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to patch options`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to patch options`);
    assert.ok(opts.options, `Property 'options' is required to patch options`);
    return this.getResource(opts)
      .then((resource) => {
        const oldOptions = resource.spec.options;
        const options = _.merge(oldOptions, opts.options);
        _.set(opts, 'options', options);
        return this.updateResource(opts);
      });
  }

  /**
   * @description Delete Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   */

  deleteResource(opts) {
    logger.info('Deleting resource with opts: ', opts);
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to delete resource`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to delete resource`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to delete resource`);
    return Promise.try(() => this.init())
      .then(() => apiserver.apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.resourceType](opts.resourceId).delete())
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Update Last Operation to opts.value for resource
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.operationName - Name of operation which was last operation
   * @param {string} opts.operationType - Type of operation which was last operation
   * @param {Object} opts.value - Unique id of the last operation ex: backup_guid
   */
  updateLastOperation(opts) {
    logger.info('Updating last operation with opts: ', opts);
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to update lastOperation`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to update lastOperation`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to update lastOperation`);
    assert.ok(opts.operationName, `Property 'operationName' is required to update lastOperation`);
    assert.ok(opts.operationType, `Property 'operationType' is required to update lastOperation`);
    assert.ok(opts.value, `Property 'value' is required to update lastOperation`);
    const metadata = {};
    metadata.labels = {};
    metadata.labels[`last_${opts.operationName}_${opts.operationType}`] = opts.value;
    const options = _.chain(opts)
      .omit('value', 'operationName', 'operationType')
      .set('metadata', metadata)
      .value();
    return this.updateResource(options);
  }



  /**
   * @description Get Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Unique id of resource
   * @param {string} opts.resourceType - Name of operation
   * @param {string} opts.resourceId - Type of operation
   */

  getResource(opts) {
    logger.debug('Get resource with opts: ', opts);
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to get resource`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to get resource`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to get resource`);
    return Promise.try(() => this.init())
      .then(() => apiserver.apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.resourceType](opts.resourceId).get())
      .then((resource) => {
        _.forEach(resource.body.spec, (val, key) => {
          try {
            resource.body.spec[key] = JSON.parse(val);
          } catch (err) {
            resource.body.spec[key] = val;
          }
        });
        _.forEach(resource.body.status, (val, key) => {
          try {
            resource.body.status[key] = JSON.parse(val);
          } catch (err) {
            resource.body.status[key] = val;
          }
        });
        return resource.body;
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Gets Last Operation
   * @param {string} opts.resourceId - Unique id of resource
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   */
  getLastOperation(opts) {
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to get lastOperation`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to get lastOperation`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to get lastOperation`);
    assert.ok(opts.operationName, `Property 'operationName' is required to get lastOperation`);
    assert.ok(opts.operationType, `Property 'operationType' is required to get lastOperation`);
    let options = _.chain(opts)
      .omit('operationName', 'operationType')
      .value();
    return this.getResource(options)
      .then(json => json.metadata.labels[`last_${opts.operationName}_${opts.operationType}`]);
  }

  /**
   * @description Get resource Options
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getOptions(opts) {
    return this.getResource(opts)
      .then(resource => resource.spec.options);
  }

  /**
   * @description Get resource response
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getResponse(opts) {
    return this.getResource(opts)
      .then(resource => resource.status.response);
  }

  /**
   * @description Get resource state
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getState(opts) {
    return this.getResource(opts)
      .then(resource => resource.status.state);
  }
}

module.exports = ApiServerClient;