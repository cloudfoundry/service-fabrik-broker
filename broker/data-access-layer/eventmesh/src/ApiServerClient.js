'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const assert = require('assert');
const yaml = require('js-yaml');
const k8s = require('@kubernetes/client-node');
const JSONStream = require('json-stream');
const camelcaseKeys = require('camelcase-keys');
const config = require('@sf/app-config');
const logger = require('@sf/logger');
const {
  CONST,
  errors: {
    Timeout,
    BadRequest,
    NotFound,
    PageNotFound,
    Conflict,
    InternalServerError,
    Forbidden,
    Gone
  }
} = require('@sf/common-utils');


function convertToHttpErrorAndThrow(err) {
  let message = '';
  let newErr;
  let code;

  if (err.body && err.body.message) {
    message = err.body.message;
  } else if (err.message) {
    message = err.message;
  }

  if (err.statusCode && err.statusCode < 600) {
    code = err.statusCode;
  } else if (err.status) {
    code = err.status;
  }

  switch (code) {
    case CONST.HTTP_STATUS_CODE.BAD_REQUEST:
      newErr = new BadRequest(message);
      break;
    case CONST.HTTP_STATUS_CODE.NOT_FOUND:
      if (message.includes('page not found')) {
        newErr = new PageNotFound(message);
      } else {
        newErr = new NotFound(message);
      }
      break;
    case CONST.HTTP_STATUS_CODE.CONFLICT:
      newErr = new Conflict(message);
      break;
    case CONST.HTTP_STATUS_CODE.FORBIDDEN:
      newErr = new Forbidden(message);
      break;
    case CONST.HTTP_STATUS_CODE.GONE:
      newErr = new Gone(message);
      break;
    default:
      newErr = new InternalServerError(message);
      break;
  }
  throw newErr;
}

function omitUndefinedFields(body) {
  const res = {};
  if (!_.isUndefined(body)) {
    for (const [key, value] of Object.entries(body)) {
      if (_.isUndefined(value) || _.isEmpty(value)) {
        continue;
      }
      if (_.isArray(value) && _.isEmpty(_.compact(value))) {
        continue;
      }
      res[key] = value;
    }
  }
  return res;
}

function transformResponse(res) {
  if (!res.statusCode) {
    res.statusCode = _.get(res, 'response.statusCode');
  }  
  res.body = omitUndefinedFields(res.body);
  return _.omit(res, 'response');
}

class ApiServerClient {
  constructor() {
    this.ready = false;
    this.apiClients = {};
    this.init();
  }

  init() {
    this.apiserverConfig = new k8s.KubeConfig();
    if (config.apiserver.getConfigInCluster) {
      this.apiserverConfig.loadFromCluster();
    } else if (config.apiserver.pathToKubeConfig) {
      this.apiserverConfig.loadFromFile(config.apiserver.pathToKubeConfig);
    } else {
      assert.fail('Config \'apiserver.pathToKubeConfig\' must be provided if \'apiserver.getConfigInCluster\' is false');
    }
    this.watch = new k8s.Watch(this.apiserverConfig);
  }

  _getApiClient(resourceGroup, version) {
    let apiType = _.get(CONST, ['APISERVER', 'RESOURCE_CLIENT', resourceGroup, version], CONST.APISERVER.RESOURCE_CLIENT.DEFAULT);
    let apiClientType = k8s[apiType];
    if (!(apiType in this.apiClients)) {
      this.apiClients[apiType] = this.apiserverConfig.makeApiClient(apiClientType);
    }
    return this.apiClients[apiType];
  }

  /**
   * Poll for Status until opts.start_state changes
   * @param {object} opts - Object containing options
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Id of the operation ex. backupGuid
   * @param {string} opts.start_state - start state of the operation ex. in_queue
   * @param {object} opts.started_at - Date object specifying operation start time
   * @param {object} opts.timeout_in_sec - Req timeout in sec (optional)
   * @param {object} opts.namespaceId - namespace Id of resource
   */
  getResourceOperationStatus(opts) {
    logger.debug(`Waiting ${CONST.EVENTMESH_POLLER_DELAY} ms to get the operation state`);
    let finalState;
    return Promise.delay(CONST.EVENTMESH_POLLER_DELAY)
      .then(() => this.getResource({
        resourceGroup: opts.resourceGroup,
        resourceType: opts.resourceType,
        resourceId: opts.resourceId,
        namespaceId: opts.namespaceId
      }))
      .then(resource => {
        const state = _.get(resource, 'status.state');
        if (state === opts.start_state) {
          const duration = (new Date() - opts.started_at) / 1000;
          logger.debug(`Polling for ${opts.start_state} duration: ${duration} `);
          if (duration > _.get(opts, 'timeout_in_sec', CONST.APISERVER.OPERATION_TIMEOUT_IN_SECS)) {
            logger.error(`${opts.resourceGroup} with guid ${opts.resourceId} not yet processed after ${duration}s`);
            throw new Timeout(`${opts.resourceGroup} with guid ${opts.resourceId} not yet processed after ${duration}s`);
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
   * Poll for Status until opts.start_state changes
   * @param {object} opts - Object containing options
   * @param {string} opts.resourceGroup - Name of resource group ex. osb.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. sfserviceinstance
   * @param {string} opts.resourceId - Id of the operation ex. instance_id
   * @param {string} opts.start_state - start state of the operation ex. in_queue
   * @param {object} opts.started_at - Date object specifying operation start time
   * @param {object} opts.timeout_in_sec - Req timeout in seconds (optional)
   * @param {object} opts.namespaceId - namespace Id of resource
   */
  // TODO:- merge getResourceOperationStatus and getOSBResourceOperationStatus after streamlining state conventions

  getOSBResourceOperationStatus(opts) {
    logger.debug(`Waiting ${CONST.EVENTMESH_POLLER_DELAY} ms to get the operation state`);
    let finalState;
    return Promise.delay(CONST.EVENTMESH_POLLER_DELAY)
      .then(() => this.getResource({
        resourceGroup: opts.resourceGroup,
        resourceType: opts.resourceType,
        resourceId: opts.resourceId,
        namespaceId: opts.namespaceId,
        requestIdentity: opts.requestIdentity
      }))
      .then(resource => {
        const state = _.get(resource, 'status.state');
        if (state === CONST.APISERVER.RESOURCE_STATE.SUCCEEDED) {
          finalState = state;
          return _.get(resource, 'status.response');
        } else if (
          state === CONST.APISERVER.RESOURCE_STATE.FAILED
        ) {
          finalState = state;
          if (_.get(resource, 'status.error')) {
            const errorResponse = _.get(resource, 'status.error');
            logger.info('RequestIdentity:', opts.requestIdentity, ',Operation manager reported error', errorResponse);
            return convertToHttpErrorAndThrow(errorResponse);
          }
          return _.get(resource, 'status.response');
        } else {
          const duration = (new Date() - opts.started_at) / 1000;
          logger.debug(`RequestIdentity: ${opts.requestIdentity} , Polling for ${opts.start_state} duration: ${duration} `);
          if (duration > _.get(opts, 'timeout_in_sec', CONST.APISERVER.OPERATION_TIMEOUT_IN_SECS)) {
            logger.error(`RequestIdentity: ${opts.requestIdentity} , ${opts.resourceGroup} with guid ${opts.resourceId} not yet processed after ${duration}s`);
            throw new Timeout(`${opts.resourceGroup} with guid ${opts.resourceId} not yet processed after ${duration}s`);
          }
          return this.getOSBResourceOperationStatus(opts);
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

  checkInstanceScheduleStatus(resourceId, startTime, timeOutinSec) {
    return Promise.delay(CONST.CLUSTER_SCHEDULER_DELAY)
      .then(() => {
        const duration = (new Date() - startTime) / 1000;
        logger.debug(`Checking instance schedule status for instance ${resourceId} for duration: ${duration}`);
        if (duration > timeOutinSec) {
          logger.error(`clusterId is not set for ${resourceId} after ${duration}s`);
          throw new Timeout(`clusterId is not set for ${resourceId} after ${duration}s`);
        } else {
          return this.getResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.INTEROPERATOR,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES,
            resourceId: resourceId,
            namespaceId: this.getNamespaceId(resourceId)
          });
        }
      })
      .then(sfserviceinstance => _.get(sfserviceinstance, 'spec.clusterId') ? sfserviceinstance : this.checkInstanceScheduleStatus(resourceId, startTime, timeOutinSec))
      .catch(err => {
        logger.error('Error occured while waiting for instance to be scheduled', err);
        return convertToHttpErrorAndThrow(err);
      });
  }
  /**
   * @description Waits till clusterId is set for sfserviceinstance
   * @param {string} resourceId - id of resource
   */
  waitTillInstanceIsScheduled(resourceId, timeOutinSec) {
    assert.ok(resourceId, 'Argument \'resourceId\' is required to get scheduled cluster for instance');
    logger.debug(`Waiting for scheduler to set clusterId on ${resourceId}`);
    if (timeOutinSec == undefined) {
      timeOutinSec = CONST.CLUSTER_SCHEDULE_TIMEOUT_IN_SEC;
    }
    return this.checkInstanceScheduleStatus(resourceId, new Date(), timeOutinSec);
  }

  /**
   * @description Register watcher for (resourceGroup , resourceType)
   * @param {string} resourceGroup - Name of the resource
   * @param {string} resourceType - Type of the resource
   * @param {string} callback - Function to call when event is received
   */
  registerWatcher(resourceGroup, resourceType, callback, queryString) {
    assert.ok(resourceGroup, 'Argument \'resourceGroup\' is required to register watcher');
    assert.ok(resourceType, 'Argument \'resourceType\' is required to register watcher');

    const resourceVersion = CONST.APISERVER.API_VERSION;
    const path = _.join(['', 'apis', resourceGroup, resourceVersion, _.lowerCase(resourceType)], '/');
    const queryParams = {
      labelSelector: queryString ? queryString : '',
      timeoutSeconds: CONST.APISERVER.WATCH_TIMEOUT
    };

    return Promise.try(() => this.watch.watch(path, queryParams, () => {}, err => {
      logger.error(`Watch ended for path ${path} with queryString ${queryString}`, err);
    }))
      .then(req => {
        const jsonStream = new JSONStream();
        req.pipe(jsonStream);
        jsonStream.on('data', callback);
        return req;
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  parseResourceDetailsFromSelfLink(selfLink) {
    // self links are typically: /apis/deployment.servicefabrik.io/v1alpha1/namespaces/default/directors/d-7
    const linkParts = _.split(selfLink, '/');
    const resourceType = linkParts[6];
    const resourceGroup = linkParts[2];
    const resourceId = linkParts[7];
    return {
      resourceGroup: resourceGroup,
      resourceType: resourceType,
      resourceId: resourceId
    };
  }

  registerCrds(resourceGroup, resourceType) {
    logger.info(`Registering CRDs for ${resourceGroup}, ${resourceType}`);
    const crdJson = this.getCrdJson(resourceGroup, resourceType);
    if (!crdJson) {
      return Promise.resolve();
    }
    const name = _.lowerCase(resourceType) + '.' + resourceGroup;
    const client = this._getApiClient(CONST.APISERVER.CRD_RESOURCE_GROUP, CONST.APISERVER.CRD_RESOURCE_GROUP_VERSION);
    return Promise.try(() => client.createCustomResourceDefinition(crdJson))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      })
      .catch(Conflict, () => {
        logger.info(`CRD ${name} already registered, patching it now..`);
        return client.patchCustomResourceDefinition(name, crdJson, undefined, undefined, undefined,
          undefined, {
            headers: {
              'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
            }
          })
          .catch(err => {
            return convertToHttpErrorAndThrow(err);
          });
      })
      .then(res => transformResponse(res));
  }

  getCrdJson(resourceGroup, resourceType) {
    const crdEncodedTemplate = _.get(config, `apiserver.crds['${resourceGroup}_${CONST.APISERVER.API_VERSION}_${resourceType}.yaml']`);
    if (crdEncodedTemplate) {
      logger.debug(`Getting crd json for: ${resourceGroup}_${CONST.APISERVER.API_VERSION}_${resourceType}.yaml`);
      return yaml.load(Buffer.from(crdEncodedTemplate, 'base64'));
    }
  }

  getCrdVersion(crdJson) {
    return _.get(crdJson, 'spec.version', _.get(crdJson, 'spec.versions[0].name', CONST.APISERVER.API_VERSION));
  }

  /**
   * @description Create Namespace of given name
   * @param {string} name - Name of resource group ex. backup.servicefabrik.io
   */
  createNamespace(name) {
    assert.ok(name, 'Property \'name\' is required to create namespace');
    if (!_.get(config, 'apiserver.enable_namespaced_separation')) {
      return Promise.resolve();
    }
    const resourceBody = {
      kind: CONST.APISERVER.NAMESPACE_OBJECT,
      apiVersion: CONST.APISERVER.NAMESPACE_API_VERSION,
      metadata: {
        name: name
      }
    };
    const client = this._getApiClient('', CONST.APISERVER.NAMESPACE_API_VERSION);
    return Promise.try(() => client.createNamespace(resourceBody))
      .tap(() => logger.debug(`Successfully created namespace ${name}`))
      .then(res => transformResponse(res))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  deleteNamespace(name) {
    const client = this._getApiClient('', CONST.APISERVER.NAMESPACE_API_VERSION);
    return Promise.try(() => client.deleteNamespace(name))
      .tap(() => logger.debug(`Successfully deleted namespace ${name}`))
      .then(res => transformResponse(res))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  getNamespaceId(resourceId) {
    if (_.get(config, 'apiserver.enable_namespaced_separation')) {
      return `sf-${resourceId}`;
    } else if (_.get(config, 'apiserver.services_namespace')) {
      return _.get(config, 'apiserver.services_namespace');
    } else {
      return _.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE);
    }
  }

  /**
   * @description Gets secret
   * @param {string} secretId - Secret Id
   * @param {string} namespaceId - mandatory namespaceId
   */
  getSecret(secretId, namespaceId) {
    assert.ok(secretId, 'Property \'secretId\' is required to get Secret');
    assert.ok(namespaceId, 'Property \'namespaceId\' is required to get Secret');
    const client = this._getApiClient('', CONST.APISERVER.SECRET_API_VERSION);
    return Promise.try(() => client.readNamespacedSecret(secretId, namespaceId))
      .then(res => transformResponse(res))
      .then(secret => secret.body)
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
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
    logger.info('Creating resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to create resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to create resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to create resource');
    assert.ok(opts.options, 'Property \'options\' is required to create resource');
    const metadata = {
      name: opts.resourceId
    };
    if (opts.labels) {
      // TODO-PR: revisit key name instance_guid
      metadata.labels = opts.labels;
    }
    const crdJson = this.getCrdJson(opts.resourceGroup, opts.resourceType);
    const group = crdJson ? crdJson.spec.group : opts.resourceGroup;
    const version = this.getCrdVersion(crdJson);
    const plural = crdJson ? crdJson.spec.names.plural : _.lowerCase(opts.resourceType);

    const resourceBody = {
      apiVersion: `${group}/${version}`,
      kind: crdJson.spec.names.kind,
      metadata: metadata,
      spec: {
        'options': JSON.stringify(opts.options)
      }
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
    const client = this._getApiClient(group, version);
    const namespaceId = this.getNamespaceId(opts.resourceId);
    // Create Namespace if not default
    return Promise.try(() => client.createNamespacedCustomObject(group, version, namespaceId, plural, resourceBody))
      .then(res => transformResponse(res))
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
    logger.silly('Updating resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to update resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to update resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to update resource');
    assert.ok(opts.metadata || opts.options || opts.status || opts.operatorMetadata, 'Property \'metadata\' or \'options\' or \'status\' or \'operatorMetadata\'  is required to update resource');

    const crdJson = this.getCrdJson(opts.resourceGroup, opts.resourceType);
    const group = crdJson ? crdJson.spec.group : opts.resourceGroup;
    const version = this.getCrdVersion(crdJson);
    const plural = crdJson ? crdJson.spec.names.plural : _.lowerCase(opts.resourceType);

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
      if (opts.operatorMetadata) {
        patchBody.operatorMetadata = opts.operatorMetadata;
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
      logger.info(`Updating - Resource ${opts.resourceId} with body - ${JSON.stringify(patchBody)}`);
      const namespaceId = this.getNamespaceId(opts.resourceId);
      const client = this._getApiClient(group, version);
      // Create Namespace if not default
      return Promise.try(() => client.patchNamespacedCustomObject(group, version, namespaceId, plural, opts.resourceId,
        patchBody, undefined, undefined, undefined, {
          headers: {
            'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
          }
        }));
    })
      .then(res => transformResponse(res))
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
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to patch options');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to patch options');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to patch options');
    assert.ok(opts.metadata || opts.options || opts.status || opts.operatorMetadata, 'Property \'metadata\' or \'options\' or \'status\' or \'operatorMetadata\' is required to patch resource');
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
        if (opts.operatorMetadata && resource.operatorMetadata) {
          const oldOperatorMetadata = _.get(resource, 'operatorMetadata');
          const operatorMetadata = _.merge(oldOperatorMetadata, opts.operatorMetadata);
          _.set(opts, 'operatorMetadata', operatorMetadata);
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
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to delete resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to delete resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to delete resource');

    const crdJson = this.getCrdJson(opts.resourceGroup, opts.resourceType);
    const group = crdJson ? crdJson.spec.group : opts.resourceGroup;
    const version = this.getCrdVersion(crdJson);
    const plural = crdJson ? crdJson.spec.names.plural : _.lowerCase(opts.resourceType);

    const namespaceId = opts.namespaceId ? opts.namespaceId : this.getNamespaceId(opts.resourceId);
    const client = this._getApiClient(group, version);

    return Promise.try(() => client.deleteNamespacedCustomObject(group, version, namespaceId, plural, opts.resourceId))
      .then(res => {
        if (_.get(config, 'apiserver.enable_namespaced_separation') && opts.resourceType === CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEINSTANCES) {
          return this.deleteNamespace(namespaceId);
        }
        return res;
      })
      .then(res => transformResponse(res))
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
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to update lastOperation');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to update lastOperation');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to update lastOperation');
    assert.ok(opts.operationName, 'Property \'operationName\' is required to update lastOperation');
    assert.ok(opts.operationType, 'Property \'operationType\' is required to update lastOperation');
    assert.ok(opts.value, 'Property \'value\' is required to update lastOperation');
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
   * @description Get a namespaced Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Group of resource the resource. eg: osb.servicefabrik.io
   * @param {string} opts.resourceType - Kind of the resource. eg: sfserviceinstances (plural)
   * @param {string} opts.resourceId - Id of resource
   * @param {string} opts.namespaceId - optional; namespace of resource
   */
  getResource(opts) {
    logger.debug('Get resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to get resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to get resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to get resource');
    const namespaceId = opts.namespaceId ? opts.namespaceId : this.getNamespaceId(opts.resourceId);

    const crdJson = this.getCrdJson(opts.resourceGroup, opts.resourceType);
    const group = crdJson ? crdJson.spec.group : opts.resourceGroup;
    const version = this.getCrdVersion(crdJson);
    const plural = crdJson ? crdJson.spec.names.plural : _.lowerCase(opts.resourceType);

    const client = this._getApiClient(group, version);
    return Promise.try(() => client.getNamespacedCustomObject(group, version, namespaceId, plural, opts.resourceId))
      .then(response => {
        _.forEach(response.body.spec, (val, key) => {
          try {
            response.body.spec[key] = JSON.parse(val);
          } catch (err) {
            response.body.spec[key] = val;
          }
        });
        _.forEach(response.body.status, (val, key) => {
          try {
            response.body.status[key] = JSON.parse(val);
          } catch (err) {
            response.body.status[key] = val;
          }
        });
        return response.body;
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Get Resources in Apiserver with the opts and query param
   * @param {string} opts.resourceGroup - Unique id of resource
   * @param {string} opts.resourceType - Name of operation
   * @param {string} opts.namespaceId - namesapce Id: optional
   * @param {object} opts.query - optional query
   * @param {boolean} opts.allNamespaces - optional, get  resources across all namespaces
   */
  getResources(opts) {
    logger.debug('Get resources with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to get resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to get resource');
    let query = {};
    if (opts.query) {
      query.qs = opts.query;
    }
    // Currently most callers are calling this function with allNamespaces: true, only metering jobs are calling without NS and defaults to. Should not be used in any other context.
    const namespaceId = opts.namespaceId ? opts.namespaceId : _.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE);

    const crdJson = this.getCrdJson(opts.resourceGroup, opts.resourceType);
    const group = crdJson ? crdJson.spec.group : opts.resourceGroup;
    const version = this.getCrdVersion(crdJson);
    const plural = crdJson ? crdJson.spec.names.plural : _.lowerCase(opts.resourceType);

    const pretty = _.get(opts, 'query.pretty');
    const _continue = _.get(opts, 'query.continue');
    const fieldSelector = _.get(opts, 'query.fieldSelector');
    const labelSelector = _.get(opts, 'query.labelSelector');
    const limit = _.get(opts, 'query.limit');
    const resourceVersion = _.get(opts, 'query.resourceVersion');
    const timeoutSeconds = _.get(opts, 'query.timeoutSeconds');
    const watch = _.get(opts, 'query.watch');

    const client = this._getApiClient(group, version);

    return Promise.try(() => {
      if (!_.get(opts, 'allNamespaces', false)) {
        return client.listNamespacedCustomObject(group, version, namespaceId, plural, pretty, _continue,
          fieldSelector, labelSelector, limit, resourceVersion, timeoutSeconds, watch);
      } else {
        return client.listClusterCustomObject(group, version, plural, pretty, _continue,
          fieldSelector, labelSelector, limit, resourceVersion, timeoutSeconds, watch);
      }
    })
      .then(response => _.get(response, 'body.items', []))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Get Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Unique id of resource
   * @param {string} opts.resourceType - Name of operation
   * @param {object} opts.query - optional query
   */
  _getParsedResources(opts) {
    return this.getResources(opts)
      .then(resources => {
        _.forEach(resources, resource => {
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
        });
        if (resources.length > 0) {
          return _.sortBy(resources, ['metadata.creationTimeStamp']);
        }
        return [];
      });
  }

  createConfigMapResource(configName, configParam) {
    logger.info(`Creating ConfigMap ${configName} with data: ${configParam}`);
    const metadata = {
      name: configName
    };
    let data = {};
    data = _.set(data, configParam.key, configParam.value);
    const resourceBody = {
      apiVersion: CONST.APISERVER.CONFIG_MAP.API_VERSION,
      kind: CONST.APISERVER.CONFIG_MAP.RESOURCE_KIND,
      metadata: metadata,
      data: data
    };
    // Currently only admin controller calls this to create configs in default NS. Should not be used in any other context.
    const namespaceId = _.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE);

    const client = this._getApiClient('', CONST.APISERVER.CONFIG_MAP.API_VERSION);
    return Promise.try(() => client.createNamespacedConfigMap(namespaceId, resourceBody))
      .then(res => transformResponse(res))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  getConfigMapResource(configName) {
    logger.debug('Get resource with opts: ', configName);
    // Currently only admin controller calls this to create configs in default NS. Should not be used in any other context.
    const namespaceId = _.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE);

    const client = this._getApiClient('', CONST.APISERVER.CONFIG_MAP.API_VERSION);
    return Promise.try(() => client.readNamespacedConfigMap(configName, namespaceId))
      .then(resource => {
        return resource.body;
      })
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  createUpdateConfigMapResource(configName, configParam) {
    const metadata = {
      name: configName
    };
    let data = {};
    data = _.set(data, configParam.key, configParam.value);
    const resourceBody = {
      apiVersion: CONST.APISERVER.CONFIG_MAP.API_VERSION,
      kind: CONST.APISERVER.CONFIG_MAP.RESOURCE_KIND,
      metadata: metadata,
      data: data
    };
    // Currently only admin controller calls this to create configs in default NS. Should not be used in any other context.
    const namespaceId = _.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE);

    const client = this._getApiClient('', CONST.APISERVER.CONFIG_MAP.API_VERSION);
    return Promise.try(() => this.getConfigMapResource(configName))
      .then(oldResourceBody => {
        resourceBody.data = oldResourceBody.data ? _.merge(oldResourceBody.data, data) : resourceBody.data;
        resourceBody.metadata.resourceVersion = oldResourceBody.metadata.resourceVersion;
        return client.patchNamespacedConfigMap(configName, namespaceId, resourceBody, undefined, undefined,
          undefined, undefined, {
            headers: {
              'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
            }
          })
          .catch(err => {
            return convertToHttpErrorAndThrow(err);
          });
      })
      .catch(NotFound, () => {
        return this.createConfigMapResource(configName, configParam)
          .catch(err => {
            return convertToHttpErrorAndThrow(err);
          });
      })
      .then(res => transformResponse(res));
  }

  getConfigMap(configName, key) {
    return this.getConfigMapResource(configName).then(body => _.get(body.data, key))
      .catch(NotFound, () => {
        return undefined;
      });
  }

  getCustomResourceDefinition(customResourceName) {
    const client = this._getApiClient(CONST.APISERVER.CRD_RESOURCE_GROUP, CONST.APISERVER.CRD_RESOURCE_GROUP_VERSION);
    return Promise.try(() => client.readCustomResourceDefinition(customResourceName))
      .then(response => response.body)
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Get Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Unique id of resource
   * @param {string} opts.resourceType - Name of operation
   * @param {array} opts.stateList - Array of states of resorces
   */
  getResourceListByState(opts) {
    logger.debug('Get resource list with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to get resource list');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to get resource list');
    assert.ok(opts.stateList, 'Property \'stateList\' is required to fetch resource list');
    return this._getParsedResources(_.assign(opts, {
      query: {
        labelSelector: `state in (${_.join(opts.stateList, ',')})`
      }
    }));
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
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to get lastOperation');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to get lastOperation');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to get lastOperation');
    assert.ok(opts.operationName, 'Property \'operationName\' is required to get lastOperation');
    assert.ok(opts.operationType, 'Property \'operationType\' is required to get lastOperation');
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
   * @description Get resource status
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getResourceStatus(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'status'));
  }

  /**
   * @description Get resource last operation
   * @param {string} opts.resourceGroup - Name of operation
   * @param {string} opts.resourceType - Type of operation
   * @param {string} opts.resourceId - Unique id of resource
   */
  getLastOperation(opts) {
    return this.getResource(opts)
      .then(resource => _.get(resource, 'status'));
  }

  /**
   * @description Get platform context
   * @param {string} opts.resourceGroup - Name of resourceGroup
   * @param {string} opts.resourceType - Type of resource
   * @param {string} opts.resourceId - Unique id of resource
   */
  getPlatformContext(opts) {
    return this.getResource({
      resourceGroup: opts.resourceGroup,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId
    })
      .then(resource => _.get(resource, 'spec.options.context'));
  }

  /**
   * @description Create OSB Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group 
   * @param {string} opts.resourceType - Type of resource 
   * @param {string} opts.resourceId - Unique id of resource 
   * @param {string} opts.metadata - Optional; pass finalizers or some other field
   * @param {string} opts.labels - to be put in label
   * @param {Object} opts.spec - Value to set for spec field of resource
   * @param {string} opts.status - status of the resource
   */
  // Note:- In this method, keys in ServiceInstance CR are required to be camelcased
  // Hence while creating resource, osb keys (snakecased) translated into camelcased using camelcase-keys module
  createOSBResource(opts) {
    logger.info('Creating OSB resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to create resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to create resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to create resource');
    assert.ok(opts.spec, 'Property \'spec\' is required to create resource');
    const metadata = _.merge(opts.metadata, {
      name: opts.resourceId
    });
    if (opts.labels) {
      metadata.labels = opts.labels;
    }
    const crdJson = this.getCrdJson(opts.resourceGroup, opts.resourceType);
    const group = crdJson ? crdJson.spec.group : opts.resourceGroup;
    const version = this.getCrdVersion(crdJson);
    const plural = crdJson ? crdJson.spec.names.plural : _.lowerCase(opts.resourceType);

    const resourceBody = {
      apiVersion: `${crdJson.spec.group}/${version}`,
      kind: crdJson.spec.names.kind,
      metadata: metadata,
      spec: camelcaseKeys(opts.spec)
    };

    if (opts.status) {
      _.forEach(opts.status, (val, key) => {
        if (key === 'state') {
          resourceBody.metadata.labels = _.merge(resourceBody.metadata.labels, {
            'state': val
          });
        }
      });
      resourceBody.status = opts.status;
    }
    const client = this._getApiClient(group, version);
    // Create Namespace if not default
    const namespaceId = this.getNamespaceId(opts.resourceType === CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS ?
      _.get(opts, 'spec.instance_id') : opts.resourceId
    );
    // Create Namespace if not default
    return Promise.try(() => client.createNamespacedCustomObject(group, version, namespaceId, plural, resourceBody))
      .then(res => transformResponse(res))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Update OSB Resource in Apiserver with the opts
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.metadata - Metadata of resource
   * @param {Object} opts.spec - Value to set for spec field of resource
   * @param {string} opts.status - status of the resource
   */
  updateOSBResource(opts) {
    logger.silly('Updating resource with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to update resource');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to update resource');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to update resource');
    assert.ok(opts.metadata || opts.spec || opts.status, 'Property \'metadata\' or \'options\' or \'status\'  is required to update resource');

    const crdJson = this.getCrdJson(opts.resourceGroup, opts.resourceType);
    const group = crdJson ? crdJson.spec.group : opts.resourceGroup;
    const version = this.getCrdVersion(crdJson);
    const plural = crdJson ? crdJson.spec.names.plural : _.lowerCase(opts.resourceType);

    return Promise.try(() => {
      const patchBody = {};
      if (opts.metadata) {
        patchBody.metadata = opts.metadata;
      }
      if (opts.spec) {
        patchBody.spec = camelcaseKeys(opts.spec);
      }
      if (opts.status) {
        _.forEach(opts.status, (val, key) => {
          if (key === 'state') {
            patchBody.metadata = _.merge(patchBody.metadata, {
              labels: {
                'state': val
              }
            });
          }
        });
        patchBody.status = opts.status;
      }
      if (opts.labels) {
        patchBody.metadata = _.merge(patchBody.metadata, {
          labels: opts.labels
        });
      }
      logger.info(`RequestIdentity: ${opts.requestIdentity} , Updating - Resource ${opts.resourceId} with body - ${JSON.stringify(patchBody)}`);

      const client = this._getApiClient(group, version);
      // Create Namespace if not default
      const namespaceId = opts.namespaceId ? opts.namespaceId : this.getNamespaceId(opts.resourceType === CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICEBINDINGS ?
        _.get(opts, 'spec.instance_id') : opts.resourceId
      );
      return Promise.try(() => client.patchNamespacedCustomObject(group, version, namespaceId, plural, opts.resourceId, patchBody,
        undefined, undefined, undefined, {
          headers: {
            'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
          }
        }));
    })
      .then(res => transformResponse(res))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      });
  }

  /**
   * @description Patches OSB Resource in Apiserver with the opts
   * Use this method when you want to append something in status.response or spec
   * @param {string} opts.resourceGroup - Name of resource group ex. backup.servicefabrik.io
   * @param {string} opts.resourceType - Type of resource ex. defaultbackup
   * @param {string} opts.resourceId - Unique id of resource ex. backup_guid
   * @param {string} opts.namespaceId - Unique id of namespace
   */
  patchOSBResource(opts) {
    logger.info('Patching resource options with opts: ', opts);
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to patch options');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to patch options');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to patch options');
    assert.ok(opts.metadata || opts.spec || opts.status, 'Property \'metadata\' or \'options\' or \'status\' is required to patch resource');

    return Promise.try(() => {
      if (_.get(opts, 'status.state') === CONST.APISERVER.RESOURCE_STATE.UPDATE) {
        // set parameters field to null
        const clearParamsReqOpts = _.pick(opts, ['resourceGroup', 'resourceType', 'resourceId', 'labels']);
        return this.updateOSBResource(_.extend(clearParamsReqOpts, {
          'spec': {
            'parameters': null
          }
        }));
      }
    })
      .then(() => this.updateOSBResource(opts));
  }

  /**
   * @description Remove finalizers from finalizer list
   * @param {string} opts.resourceGroup - Name of resource group 
   * @param {string} opts.resourceType - Type of resource 
   * @param {string} opts.resourceId - Unique id of resource
   * @param {string} opts.finalizer - Name of finalizer
   */
  removeFinalizers(opts) {
    assert.ok(opts.resourceGroup, 'Property \'resourceGroup\' is required to remove finalizer');
    assert.ok(opts.resourceType, 'Property \'resourceType\' is required to remove finalizer');
    assert.ok(opts.resourceId, 'Property \'resourceId\' is required to remove finalizer');
    assert.ok(opts.finalizer, 'Property \'finalizer\' is required to remove finalizer');
    assert.ok(opts.namespaceId, 'Property \'namespaceId\' is required to remove finalizer');
    return this.getResource(opts)
      .then(resourceBody => {
        opts.metadata = {
          resourceVersion: _.get(resourceBody, 'metadata.resourceVersion'),
          finalizers: _.pull(_.get(resourceBody, 'metadata.finalizers'), opts.finalizer)
        };
        return this.updateOSBResource(opts);
      });

  }

  /**
   * @description Create Service/Plan Resource in Apiserver with given crd
   */
  createOrUpdateServicePlan(crd) {
    logger.debug('Creating service/plan resource with CRD: ', crd);
    assert.ok(crd, 'Property \'crd\' is required to create Service/Plan Resource');
    const resourceType = crd.kind === 'SFService' ? CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_SERVICES : CONST.APISERVER.RESOURCE_TYPES.INTEROPERATOR_PLANS;

    // Default NS is used in this context since it is only done for the BOSH use case, shouldn't be used in any other context.
    const namespaceId = _.get(config, 'sf_namespace', CONST.APISERVER.DEFAULT_NAMESPACE);
    const apiVersion = _.split(_.get(crd, 'apiVersion'), '/');
    const group = apiVersion[0];
    const version = apiVersion[1];
    const plural = _.lowerCase(resourceType);
    const name = _.get(crd, 'metadata.name');

    const client = this._getApiClient(group, version);
    return Promise.try(() => client.createNamespacedCustomObject(group, version, namespaceId, plural, crd))
      .catch(err => {
        return convertToHttpErrorAndThrow(err);
      })
      .catch(Conflict, () => client.patchNamespacedCustomObject(group, version, namespaceId, plural, name, crd, undefined, undefined,
        undefined, {
          headers: {
            'content-type': CONST.APISERVER.PATCH_CONTENT_TYPE
          }
        })
        .catch(err => {
          return convertToHttpErrorAndThrow(err);
        })
      )
      .then(res => transformResponse(res));
  }
}

module.exports = ApiServerClient;
