'use strict';

const _ = require('lodash');
const assert = require('assert');
const CONST = require('../common/constants');
const errors = require('../common/errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class EventMeshServer {

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

  getOperationFolderName(opts) {
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

  createOperationResource(opts) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('createOperationResource');
  }

  updateOperationState(opts) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('updateOperationState');
  }

  updateOperationKey(opts) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('updateOperationKey');
  }

  getOperationKeyValue(opts) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getOperationKeyValue');
  }

  getOperationState(opts) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getOperationState');
  }
}

module.exports = EventMeshServer;