'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const assert = require('assert');
const yaml = require('js-yaml');
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
    cert: config.apiserver.certificate,
    key: config.apiserver.private_key,
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
  case CONST.HTTP_STATUS_CODE.GONE:
    newErr = new errors.Gone(message);
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
        return Promise.map(_.values(config.apiserver.crds), crdTemplate => {
            apiserver.addCustomResourceDefinition(yaml.safeLoad(Buffer.from(crdTemplate, 'base64')));
          })
          .then(() => apiserver.loadSpec())
          .then(() => {
            this.ready = true;
            logger.debug('Successfully loaded ApiServer Spec');
          })
          .catch(err => {
            logger.error('Error occured while loading ApiServer Spec', err);
            return convertToHttpErrorAndThrow(err);
          });
      }
    });
  }
  /**
   * Poll for Status until opts.start_state changes
   * @param {object} opts - Object containing options
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Id of the operation ex. backupGuid
   * @param {string} opts.start_state - start state of the operation ex. in_queue
   * @param {object} opts.started_at - Date object specifying operation start time
   */
  getResourceOperationStatus(opts) {
    logger.debug(`Waiting ${CONST.EVENTMESH_POLLER_DELAY} ms to get the operation state`);
    let finalState;
    return Promise.delay(CONST.EVENTMESH_POLLER_DELAY)
      .then(() => this.getResource({
        resourceGroup: opts.resourceGroup,
        resourceType: opts.resourceType,
        resourceId: opts.resourceId
      }))
      .then(resource => {
        const state = _.get(resource, 'status.state');
        if (state === opts.start_state) {
          const duration = (new Date() - opts.started_at) / 1000;
          logger.debug(`Polling for ${opts.start_state} duration: ${duration} `);
          if (duration > CONST.APISERVER.OPERATION_TIMEOUT_IN_SECS) {
            logger.error(`${opts.resourceGroup} with guid ${opts.resourceId} not yet processed`);
            throw new Timeout(`${opts.resourceGroup} with guid ${opts.resourceId} not yet processed`);
          }
          return this.getResourceOperationStatus(opts);
        } else if (
          state === CONST.APISERVER.RESOURCE_STATE.FAILED ||
          state === CONST.APISERVER.RESOURCE_STATE.DELETE_FAILED
        ) {
          finalState = state;
          if (_.get(resource, 'status.error')) {
            const errorResponse = _.get(resource, 'status.error');
            logger.info('Operation manager reported error', errorResponse);
            return convertToHttpErrorAndThrow(errorResponse);
          }
        } else {
          finalState = state;
          return _.get(resource, 'status.response');
        }
      })
      .then(result => {
        if (_.get(result, 'state')) {
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
    assert.ok(resourceGroup, `Argument 'resourceGroup' is required to register watcher`);
    assert.ok(resourceType, `Argument 'resourceType' is required to register watcher`);
    return Promise.try(() => this.init())
      .then(() => {
        const stream = apiserver
          .apis[resourceGroup][CONST.APISERVER.API_VERSION]
          .watch[resourceType].getStream({
            qs: {
              labelSelector: queryString ? queryString : '',
              timeoutSeconds: CONST.APISERVER.WATCH_TIMEOUT
            }
          });
        const jsonStream = new JSONStream();
        stream.pipe(jsonStream);
        jsonStream.on('data', callback);
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

  registerCrds(resourceGroup, resourceType) {
    logger.info(`Registering CRDs for ${resourceGroup}, ${resourceType}`);
    const crdJson = this.getCrdJson(resourceGroup, resourceType);
    return Promise.try(() => this.init())
      .then(() => {
        return apiserver.apis[CONST.APISERVER.CRD_RESOURCE_GROUP].v1beta1.customresourcedefinitions(crdJson.metadata.name).patch({
            body: crdJson,
            headers: {
              'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
            }
          })
          .catch(err => {
            return convertToHttpErrorAndThrow(err);
          });
      })
      .catch(NotFound, () => {
        logger.info(`CRD with resourcegroup ${resourceGroup} and resource ${resourceType} not yet registered, registering it now..`);
        return apiserver.apis[CONST.APISERVER.CRD_RESOURCE_GROUP].v1beta1.customresourcedefinitions.post({
          body: crdJson
        });
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  getCrdJson(resourceGroup, resourceType) {
    const crdEncodedTemplate = config.apiserver.crds[`${resourceGroup}_${CONST.APISERVER.API_VERSION}_${resourceType}.yaml`];
    logger.debug(`Getting crd json for: ${resourceGroup}_${CONST.APISERVER.API_VERSION}_${resourceType}.yaml`);
    return yaml.safeLoad(Buffer.from(crdEncodedTemplate, 'base64'));
  }

  /**
   * @description Create Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.labels - to be put in label ex: instance_guid
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
    if (opts.labels) {
      // TODO-PR: revisit key name instance_guid
      metadata.labels = opts.labels;
    }
    const crdJson = this.getCrdJson(opts.resourceGroup, opts.resourceType);
    const resourceBody = {
      apiVersion: `${crdJson.spec.group}/${crdJson.spec.version}`,
      kind: crdJson.spec.names.kind,
      metadata: metadata,
      spec: {
        'options': JSON.stringify(opts.options)
      },
    };

    if (opts.status) {
      const statusJson = {};
      _.forEach(opts.status, (val, key) => {
        if (key === 'state') {
          resourceBody.metadata.labels = _.merge(resourceBody.metadata.labels, {
            'state': val
          });
        }
        statusJson[key] = _.isObject(val) ? JSON.stringify(val) : val;
      });
      resourceBody.status = statusJson;
    }
    return Promise.try(() => this.init())
      .then(() => apiserver
        .apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.resourceType].post({
          body: resourceBody
        }))
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
    assert.ok(opts.metadata || opts.options || opts.status, `Property 'metadata' or 'options' or 'status' is required to update resource`);
    return Promise.try(() => {
        const patchBody = {};
        if (opts.metadata) {
          patchBody.metadata = opts.metadata;
        }
        if (opts.options) {
          patchBody.spec = {
            'options': JSON.stringify(opts.options)
          };
        }
        if (opts.status) {
          const statusJson = {};
          _.forEach(opts.status, (val, key) => {
            if (key === 'state') {
              patchBody.metadata = _.merge(patchBody.metadata, {
                labels: {
                  'state': val
                }
              });
            }
            statusJson[key] = _.isObject(val) ? JSON.stringify(val) : val;
          });
          patchBody.status = statusJson;
        }
        return Promise.try(() => this.init())
          .then(() => apiserver
            .apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
            .namespaces(CONST.APISERVER.NAMESPACE)[opts.resourceType](opts.resourceId).patch({
              body: patchBody,
              headers: {
                'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
              }
            }));
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }
  /**
   * @description Patches Resource in Apiserver with the opts
   * Use this method when you want to append something in status.response or spec.options
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   */
  patchResource(opts) {
    logger.info('Patching resource options with opts: ', opts);
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to patch options`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to patch options`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to patch options`);
    assert.ok(opts.metadata || opts.options || opts.status, `Property 'metadata' or 'options' or 'status' is required to patch resource`);
    return this.getResource(opts)
      .then(resource => {
        if (_.get(opts, 'status.response') && resource.status) {
          const oldResponse = _.get(resource, 'status.response');
          const response = _.merge(oldResponse, opts.status.response);
          _.set(opts.status, 'response', response);
        }
        if (opts.options && resource.spec) {
          const oldOptions = _.get(resource, 'spec.options');
          const options = _.merge(oldOptions, opts.options);
          _.set(opts, 'options', options);
        }
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
  updateLastOperationValue(opts) {
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
      .then(resource => {
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
   * @description Get Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Unique id of resource
   * @param {string} opts.resourceType - Name of operation
   * @param {string} opts.stateList - State of resorce
   */
  getResourceListByState(opts) {
    logger.debug('Get resource with opts: ', opts);
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to get resource list`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to get resource list`);
    assert.ok(opts.stateList, `Property 'stateList' is required to fetch resource list`);
    return Promise.try(() => this.init())
      .then(() => apiserver.apis[opts.resourceGroup][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.resourceType].get({
          qs: {
            labelSelector: `state in (${_.join(opts.stateList, ',')})`
          }
        }))
      .then(resources => _.get(resources.body, 'items'))
      .map(resource => {
        _.forEach(resource.spec, (val, key) => {
          try {
            resource.spec[key] = JSON.parse(val);
          } catch (err) {
            resource.spec[key] = val;
          }
        });
        _.forEach(resource.status, (val, key) => {
          try {
            resource.status[key] = JSON.parse(val);
          } catch (err) {
            resource.status[key] = val;
          }
        });
        return resource;
      })
      .catch(err => convertToHttpErrorAndThrow(err));
  }

  /**
   * @description Gets Last Operation
   * @param {string} opts.resourceId - Unique id of resource
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.operationName - Name of operation
   * @param {string} opts.operationType - Type of operation
   */
  getLastOperationValue(opts) {
    assert.ok(opts.resourceGroup, `Property 'resourceGroup' is required to get lastOperation`);
    assert.ok(opts.resourceType, `Property 'resourceType' is required to get lastOperation`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to get lastOperation`);
    assert.ok(opts.operationName, `Property 'operationName' is required to get lastOperation`);
    assert.ok(opts.operationType, `Property 'operationType' is required to get lastOperation`);
    let options = _.chain(opts)
      .omit('operationName', 'operationType')
      .value();
    logger.debug(`Getting label:  last_${opts.operationName}_${opts.operationType}`);
    return this.getResource(options)
      .then(json => _.get(json.metadata, `labels.last_${opts.operationName}_${opts.operationType}`));
  }

  /**
   * @description Get resource Options
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getOptions(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'spec.options'));
  }

  /**
   * @description Get resource response
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getResponse(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'status.response'));
  }

  /**
   * @description Get resource state
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getResourceState(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'status.state'));
  }

  /**
   * @description Get resource last operation
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getLastOperation(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'status.lastOperation'));
  }

}

module.exports = ApiServerClient;