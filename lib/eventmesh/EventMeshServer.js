'use strict';

const errors = require('../errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class EventMeshServer {
  constructor() {}

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

  getResourceKey(resourceType, resourceId, key) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getResourceKey');
  }

  getResourceState(resourceType, resourceId) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getResourceState');
  }

  registerWatcher(key, callback, isRecursive) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('registerWatcher');
  }

  annotateResource(resourceType, resourceId, annotationName, operationType, opId, val) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('annotateResource');
  }

  updateAnnotationState(resourceType, resourceId, annotationName, operationType, opId, stateValue) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('updateAnnotationState');
  }

  updateAnnotationKey(resourceType, resourceId, annotationName, operationType, opId, key, value) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('updateAnnotationKey');
  }

  getAnnotationKey(resourceType, resourceId, annotationName, operationType, opId, key) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getAnnotationKey');
  }

  getAnnotationState(resourceType, resourceId, annotationName, operationType, opId) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('getAnnotationState');
  }

}

module.exports = EventMeshServer;