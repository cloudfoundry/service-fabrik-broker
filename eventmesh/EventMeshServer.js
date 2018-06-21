'use strict';

const _ = require('lodash');
const assert = require('assert');
const CONST = require('../common/constants');
const errors = require('../common/errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class EventMeshServer {

  /*
   * EventMeshServer
   * ===============
   *
   * Various key types are documented below.
   *
   * Top level keys:
   *    - /services
   *    - /deployments
   *
   * Resources:
   *    - /deployments/<resourceType>/<resourceId>
   * Resource attributes:
   *    - /deployments/<resourceType>/<resourceId>/options
   *    - /deployments/<resourceType>/<resourceId>/state
   *    - /deployments/<resourceType>/<resourceId>/lastoperation
   *
   * Annotations:
   *    Annotations are operations that can be performed on the resource
   *    - <annotationName>/<annotationType>/<resourceId>/<annotationId>
   *    e.g:
   *      /backup/default/<resource guid>/<a guid>
   *      /backup/bbr/<resource guid>/<a guid>
   *      /restore/default/<resource guid>/<a guid>
   * Annotations attributes:
   *    - /<annotationName>/<annotationType>/<resourceId>/<annotationId>/options
   *    - /<annotationName>/<annotationType>/<resourceId>/<annotationId>/state
   *    - /<annotationName>/<annotationType>/<resourceId>/last
   *
   */

  constructor() {}

  checkValidState(state) {
    return Promise.try(() => {
      if (_.indexOf(_.map(CONST.APISERVER.RESOURCE_STATE, (a) => a), state) < 0) {
        throw new errors.NotFound(`Could not find state ${state}`);
      }
    });
  }

  getServiceFolderName(resourceType, serviceId) {
    return `services/${resourceType}/${serviceId}`;
  }

  getResourceFolderName(resourceType, resourceId) {
    return `deployments/${resourceType}/${resourceId}`;
  }

  getAnnotationFolderName(opts) {
    assert.ok(opts.resourceId, `Property 'resourceId' is required to get annotation folder name`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to get annotation folder name`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to get annotation folder name`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to get annotation folder name`);
    return `${opts.annotationName}/${opts.annotationType}/${opts.resourceId}/${opts.annotationId}`;
  }

  registerService(resourceType, serviceId, serviceAttributesValue, servicePlansValue) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('registerService');
  }

  getServiceAttributes(resourceType, serviceId) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getServiceAttributes');
  }

  getServicePlans(resourceType, serviceId) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getServicePlans');
  }

  createDeploymentResource(resourceType, resourceId, val) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('createDeploymentResource');
  }

  updateResourceState(resourceType, resourceId, stateValue) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('updateResourceState');
  }

  updateResourceKey(resourceType, resourceId, key, value) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('updateResourceKey');
  }

  getResourceKeyValue(resourceType, resourceId, key) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getResourceKeyValue');
  }

  getResourceState(resourceType, resourceId) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getResourceState');
  }

  registerWatcher(key, callback, watchOnPrefix) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('registerWatcher');
  }

  annotateResource(opts) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('annotateResource');
  }

  updateAnnotationState(opts) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('updateAnnotationState');
  }

  updateAnnotationKey(opts) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('updateAnnotationKey');
  }

  getAnnotationKeyValue(opts) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getAnnotationKeyValue');
  }

  getAnnotationState(opts) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getAnnotationState');
  }
}

module.exports = EventMeshServer;