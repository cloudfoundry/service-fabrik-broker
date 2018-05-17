'use strict';

const _ = require('lodash');
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
   *    - /deployments/<resourceType>/<resourceId>/<annotationName>/<annotationType>/<annotationId>
   *    e.g:
   *      /deployments/docker/<a guid>/backup/incremental/<a guid>
   *      /deployments/docker/<a guid>/restore/default/<a guid>
   * Annotations attributes:
   *    - /deployments/<resourceType>/<resourceId>/<annotationName>/<annotationType>/<annotationId>/options
   *    - /deployments/<resourceType>/<resourceId>/<annotationName>/<annotationType>/<annotationId>/state
   *
   */

  constructor() {}

  checkValidState(state) {
    return Promise.try(() => {
      if (_.indexOf(_.map(CONST.RESOURCE_STATE, (a) => a), state) < 0) {
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

  getAnnotationFolderName(resourceType, resourceId, annotationName, annotationType, annotationId) {
    const resourceFolderName = this.getResourceFolderName(resourceType, resourceId);
    return `${resourceFolderName}/${annotationName}/${annotationType}/${annotationId}`;
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

  createResource(resourceType, resourceId, val) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('createResource');
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

  registerWatcher(key, callback, isRecursive) {
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