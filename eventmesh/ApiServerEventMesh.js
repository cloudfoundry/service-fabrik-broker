'use strict';

const Promise = require('bluebird');
const assert = require('assert');
const config = require('../common/config');
const logger = require('../common/logger');
const CONST = require('../common/constants');
const EventMeshServer = require('./EventMeshServer');
const kc = require('kubernetes-client');
const JSONStream = require('json-stream');
const errors = require('../common/errors');
const BadRequest = errors.BadRequest;
const NotFound = errors.NotFound;
const Conflict = errors.Conflict;
const InternalServerError = errors.InternalServerError;

const apiserver = new kc.Client({
  config: {
    url: `https://${config.internal.ip}:9443`,
    insecureSkipTlsVerify: true
  },
  version: '1.9'
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

class ApiServerEventMesh extends EventMeshServer {
  registerWatcher(resourceName, resourceType, callback) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => {
        const stream = apiserver
          .apis[`${resourceName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
          .watch.namespaces(CONST.APISERVER.NAMESPACE)[resourceType].getStream();
        const jsonStream = new JSONStream();
        stream.pipe(jsonStream);
        jsonStream.on('data', callback);
      })
      .catch(err => {
        return buildErrors(err);
      });
  }

  createResource(resourceName, resourceType, body) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${resourceName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType].post({
          body: body
        }));
  }

  createLockResource(name, type, body) {
    return this.createResource(name, type, body)
      .catch(err => {
        return buildErrors(err);
      });
  }
  deleteLockResource(resourceName, resourceType, resourceId) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver.apis[`${resourceName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId).delete())
      .catch(err => {
        return buildErrors(err);
      });
  }
  updateResource(resourceName, resourceType, resourceId, delta) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver.apis[`${resourceName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId).patch({
          body: delta
        }))
      .catch(err => {
        return buildErrors(err);
      });
  }
  getLockResourceOptions(resourceName, resourceType, resourceId) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver.apis[`${resourceName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId).get())
      .then(resource => {
        return resource.body.spec.options;
      })
      .catch(err => {
        return buildErrors(err);
      });
  }
  getResource(resourceName, resourceType, resourceId) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver.apis[`${resourceName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId).get())
      .catch(err => {
        return buildErrors(err);
      });
  }

  createDeploymentResource(resourceType, resourceId, val) {
    const opts = {
      annotationId: resourceId,
      resourceId: resourceId,
      annotationName: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT,
      annotationType: CONST.APISERVER.RESOURCE_NAMES.DIRECTOR,
      val: val
    };
    return this.createOperationResource(opts);
  }

  updateResourceState(resourceType, resourceId, stateValue) {
    const opts = {
      annotationId: resourceId,
      resourceId: resourceId,
      annotationName: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT,
      annotationType: resourceType,
      stateValue: stateValue
    };
    return this.updateAnnotationState(opts);
  }

  getResourceState(resourceType, resourceId) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId)
        .get())
      .then(json => json.body.status.state)
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   *
   * @params opts.resourceId
   * @params opts.annotationName
   * @params opts.annotationType
   * @params opts.annotationId
   * @params opts.val
   */
  createOperationResource(opts) {
    logger.info('Creating resource with options:', opts.val);
    const initialResource = {
      metadata: {
        'name': `${opts.annotationId}`,
        'labels': {
          instance_guid: `${opts.resourceId}`,
        },
      },
      spec: {
        'options': JSON.stringify(opts.val)
      },
    };
    const statusJson = {
      status: {
        state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
        lastOperation: 'created',
        response: JSON.stringify({})
      }
    };
    return this.createResource(opts.annotationName, opts.annotationType, initialResource)
      .then(() => apiserver.apis[`${opts.annotationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.annotationType](opts.annotationId).status.patch({
          body: statusJson
        }))
      .catch(err => {
        return buildErrors(err);
      });
  }
  /**
   * @params opts.resourceId
   * @params opts.annotationName
   * @params opts.annotationType
   * @params opts.annotationId
   * @params opts.value
   */
  updateAnnotationResult(opts) {
    logger.info('Updating Annotation Result with :', opts);
    const patchedResource = {
      'status': {
        'response': JSON.stringify(opts.value),
      }
    };
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${opts.annotationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.annotationType](opts.annotationId)
        .status.patch({
          body: patchedResource
        }))
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @params opts.annotationName
   * @params opts.annotationType
   * @params opts.annotationId
   * @params opts.stateValue
   */
  updateAnnotationState(opts) {
    logger.info('Updating Annotation State with :', opts);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to update annotation state`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to update annotation state`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to update annotation state`);
    assert.ok(opts.stateValue, `Property 'stateValue' is required to update annotation state`);
    const patchedResource = {
      'status': {
        'state': opts.stateValue
      }
    };
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${opts.annotationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.annotationType](opts.annotationId)
        .status.patch({
          body: patchedResource
        }))
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @params opts.resourceId
   * @params opts.annotationName
   * @params opts.annotationType
   * @params opts.value
   */
  updateLastAnnotation(opts) {
    const patchedResource = {};
    patchedResource.metadata = {};
    patchedResource.metadata.labels = {};
    patchedResource.metadata.labels[`last_${opts.annotationName}_${opts.annotationType}`] = opts.value;
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[CONST.APISERVER.RESOURCE_NAMES.DIRECTOR](opts.resourceId)
        .patch({
          body: patchedResource
        }))
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @params opts.resourceId
   * @params opts.annotationName
   * @params opts.annotationType
   */
  getLastAnnotation(opts) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[CONST.APISERVER.RESOURCE_NAMES.DIRECTOR](opts.resourceId)
        .get())
      .then(json => json.body.metadata.labels[`last_${opts.annotationName}_${opts.annotationType}`])
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @params opts.resourceId
   * @params opts.annotationName
   * @params opts.annotationType
   * @params opts.annotationId
   * returns string
   */
  getAnnotationOptions(opts) {
    assert.ok(opts.resourceId, `Property 'resourceId' is required to get annotation state`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to get annotation state`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to get annotation state`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to get annotation state`);
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${opts.annotationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.annotationType](opts.annotationId)
        .get())
      .then(json => json.body.spec.options)
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @params opts.resourceId
   * @params opts.annotationName
   * @params opts.annotationType
   * @params opts.annotationId
   * returns string
   */
  getAnnotationState(opts) {
    assert.ok(opts.resourceId, `Property 'resourceId' is required to get annotation state`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to get annotation state`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to get annotation state`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to get annotation state`);
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${opts.annotationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.annotationType](opts.annotationId)
        .get())
      .then(json => json.body.status.state)
      .catch(err => {
        return buildErrors(err);
      });
  }

  /**
   * @params opts.resourceId
   * @params opts.annotationName
   * @params opts.annotationType
   * @params opts.annotationId
   * returns string
   */
  getAnnotationResult(opts) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${opts.annotationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.annotationType](opts.annotationId)
        .get())
      .then(json => json.body.status.response)
      .catch(err => {
        return buildErrors(err);
      });
  }

}

module.exports = ApiServerEventMesh;