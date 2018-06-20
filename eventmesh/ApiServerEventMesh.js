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
const HttpError = errors.HttpError;

const apiserver = new kc.Client({
  config: {
    url: `https://${config.internal.ip}:9443`,
    insecureSkipTlsVerify: true
  },
  version: '1.9'
});

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
        throw new HttpError(err.code, err.message);
      });
  }
  createLockResource(name, type, body) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver.apis[`${name}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[type].post({
          body: body
        }))
      .catch(err => {
        throw new HttpError(err.code, err.message);
      });
  }
  deleteLockResource(name, type, resourceName) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver.apis[`${name}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[type](resourceName).delete())
      .catch(err => {
        throw new HttpError(err.code, err.message);
      });
  }
  updateLockResource(name, type, resourceName, delta) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver.apis[`${name}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[type](resourceName).patch({
          body: delta
        }))
      .catch(err => {
        throw new HttpError(err.code, err.message);
      });
  }
  getLockResourceOptions(name, type, resourceName) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver.apis[`${name}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[type](resourceName).get())
      .then(resource => {
        return resource.body.spec.options;
      })
      .catch(err => {
        throw new HttpError(err.code, err.message);
      });
  }
  getResource(name, type, resourceName) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver.apis[`${name}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[type](resourceName).get())
      .catch(err => {
        throw new HttpError(err.code, err.message);
      });
  }

  createResource(resourceType, resourceId, val) {
    logger.debug(`Creating Resource ${resourceType}/${resourceId}`);

    const initialResource = {
      metadata: {
        name: resourceId,
        'labels': {
          instance_guid: `${resourceId}`,
        },
      },
      spec: {
        'options': JSON.stringify(val)
      },
    };

    const statusJson = {
      status: {
        state: CONST.APISERVER.STATE.IN_QUEUE,
        lastOperation: 'created',
        response: JSON.stringify({})
      }
    };

    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${CONST.RESOURCE_TYPES.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[CONST.RESOURCE_NAMES.DIRECTOR].post({
          body: initialResource
        }))
      .then(() => apiserver.apis[`${CONST.RESOURCE_TYPES.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[CONST.RESOURCE_NAMES.DIRECTOR](resourceId).status.patch({
          body: statusJson
        }))
      .catch(err => {
        throw new HttpError(err.code, err.message);
      });
  }

  updateResourceState(resourceType, resourceId, stateValue) {
    const patchedResource = {
      'status': {
        'state': stateValue
      }
    };
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${CONST.RESOURCE_TYPES.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId)
        .status.patch({
          body: patchedResource
        }))
      .catch(err => {
        throw new HttpError(err.code, err.message);
      });
  }

  getResourceState(resourceType, resourceId) {
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver
        .apis[`${CONST.RESOURCE_TYPES.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[resourceType](resourceId)
        .get())
      .then(json => json.body.status.state)
      .catch(err => {
        throw new HttpError(err.code, err.message);
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
  annotateResource(opts) {
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
        state: CONST.APISERVER.STATE.IN_QUEUE,
        lastOperation: '',
        response: ''
      }
    };
    return Promise.try(() => apiserver.loadSpec())
      .then(() => apiserver.apis[`${opts.annotationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.annotationType].post({
          body: initialResource
        }))
      .then(() => apiserver.apis[`${opts.annotationName}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[opts.annotationType](opts.annotationId).status.patch({
          body: statusJson
        }))
      .catch(err => {
        throw new HttpError(err.code, err.message);
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
        throw new HttpError(err.code, err.message);
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
        throw new HttpError(err.code, err.message);
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
        .apis[`${CONST.RESOURCE_TYPES.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[CONST.RESOURCE_NAMES.DIRECTOR](opts.resourceId)
        .patch({
          body: patchedResource
        }))
      .catch(err => {
        throw new HttpError(err.code, err.message);
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
        .apis[`${CONST.RESOURCE_TYPES.DEPLOYMENT}.${CONST.APISERVER.HOSTNAME}`][CONST.APISERVER.API_VERSION]
        .namespaces(CONST.APISERVER.NAMESPACE)[CONST.RESOURCE_NAMES.DIRECTOR](opts.resourceId)
        .get())
      .then(json => json.body.metadata.labels[`last_${opts.annotationName}_${opts.annotationType}`])
      .catch(err => {
        throw new HttpError(err.code, err.message);
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
        throw new HttpError(err.code, err.message);
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
        throw new HttpError(err.code, err.message);
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
        throw new HttpError(err.code, err.message);
      });
  }

}

module.exports = ApiServerEventMesh;