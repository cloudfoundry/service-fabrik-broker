'use strict';

const _ = require('lodash');
const assert = require('assert');
const config = require('./config');
const logger = require('../common/logger');
const CONST = require('../common/constants');
const EventMeshServer = require('./EventMeshServer');
const {
  Etcd3
} = require('etcd3');
const etcd = new Etcd3({
  hosts: config.etcd.url
});

class Etcd3EventMeshServer extends EventMeshServer {
  registerService(resourceType, serviceId, serviceAttributesValue, servicePlansValue) {
    const serviceFolderName = this.getServiceFolderName(resourceType, serviceId);
    const attributesKey = `${serviceFolderName}/${CONST.SERVICE_KEYS.ATTRIBUTES}`;
    logger.debug(`Registering Service ${serviceId} for resource ${resourceType}` +
      `with attributes: ${serviceAttributesValue} and plans: ${servicePlansValue}`);
    return etcd.put(attributesKey).value(JSON.stringify(serviceAttributesValue))
      .then(() => {
        const plansKey = `${serviceFolderName}/${CONST.SERVICE_KEYS.PLANS}`;
        return etcd.put(plansKey).value(JSON.stringify(servicePlansValue));
      });
  }

  getServiceAttributes(resourceType, serviceId) {
    const serviceFolderName = this.getServiceFolderName(resourceType, serviceId);
    const attrKey = `${serviceFolderName}/${CONST.SERVICE_KEYS.ATTRIBUTES}`;
    logger.debug('Getting Service Attributes for serviceId:', serviceId);
    return etcd.get(attrKey).json();
  }

  getServicePlans(resourceType, serviceId) {
    logger.debug(`Getting Service plans for ${resourceType}/${serviceId}`);
    const serviceFolderName = this.getServiceFolderName(resourceType, serviceId);
    const plansKey = `${serviceFolderName}/${CONST.SERVICE_KEYS.PLANS}`;
    return etcd.get(plansKey).json();
  }

  createResource(resourceType, resourceId, val) {
    logger.debug(`Creating Resource ${resourceType}/${resourceId}`);
    const resourceFolderName = this.getResourceFolderName(resourceType, resourceId);
    const optionKey = `${resourceFolderName}/${CONST.RESOURCE_KEYS.OPTIONS}`;
    const statusKey = `${resourceFolderName}/${CONST.RESOURCE_KEYS.STATE}`;
    const lastOperationKey = `${resourceFolderName}/${CONST.RESOURCE_KEYS.LASTOPERATION}`;
    return etcd.put(optionKey).value(val)
      .then(() => etcd.put(statusKey).value(CONST.RESOURCE_STATE.IN_QUEUE))
      .then(() => etcd.put(lastOperationKey).value(''));
  }

  updateResourceState(resourceType, resourceId, stateValue) {
    return this.checkValidState(stateValue)
      .then(() => this.updateResourceKey(resourceType, resourceId, CONST.RESOURCE_KEYS.STATE, stateValue));
  }

  updateResourceKey(resourceType, resourceId, key, value) {
    const resourceFolderName = this.getResourceFolderName(resourceType, resourceId);
    const resourceKey = `${resourceFolderName}/${key}`;
    logger.debug(`Updating resource key: ${key} for ${resourceId}`);
    return etcd.put(resourceKey).value(value);
  }

  getResourceKey(resourceType, resourceId, key) {
    logger.debug(`Getting resource key: ${key} for ${resourceType}/${resourceId}`);
    const resourceFolderName = this.getResourceFolderName(resourceType, resourceId);
    const resourceKey = `${resourceFolderName}/${key}`;
    return etcd.get(resourceKey).string();
  }

  getResourceState(resourceType, resourceId) {
    return this.getResourceKey(resourceType, resourceId, CONST.RESOURCE_KEYS.STATE);
  }

  registerWatcher(key, callback, isRecursive) {
    if (isRecursive === true) {
      logger.debug(`Registering recursive watcher on prefix: ${key}`);
      return etcd.watch()
        .prefix(key)
        .create()
        .then(watcher => {
          return watcher
            .on('put', callback);
        });
    } else {
      logger.debug(`Registering watcher on key: ${key}`);
      return etcd.watch()
        .key(key)
        .create()
        .then(watcher => {
          return watcher
            .on('put', callback);
        });
    }
  }

  annotateResource(resourceType, resourceId, annotationName, annotationType, annotationId, val) {
    const annotationFolderName = this.getAnnotationFolderName(resourceType, resourceId, annotationName, annotationType, annotationId);
    const optionKey = `${annotationFolderName}/${CONST.ANNOTATION_KEYS.OPTIONS}`;
    logger.debug(`Annotating Resource ${resourceType}/${resourceId} for annotation: ${annotationName}`);
    return etcd.put(optionKey).value(val)
      .then(() => {
        const statusKey = `${annotationFolderName}/${CONST.ANNOTATION_KEYS.STATE}`;
        return etcd.put(statusKey).value(CONST.RESOURCE_STATE.IN_QUEUE);
      });
  }

  updateAnnotationState(resourceType, resourceId, annotationName, annotationType, annotationId, stateValue) {
    let opts = {
      resourceType: resourceType,
      resourceId: resourceId,
      annotationName: annotationName,
      annotationType: annotationType,
      annotationId: annotationId,
      stateValue: stateValue
    }
    assert.ok(opts.resourceType, `Property 'resourceType' is required to update annotation State`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to update annotation key`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to update annotation key`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to update annotation key`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to update annotation key`);
    assert.ok(opts.stateValue, `Property 'stateValue' is required to update annotation key`);
    opts = _.assign(opts, {
      key: CONST.ANNOTATION_KEYS.STATE,
      value: stateValue
    })
    opts = _.omit(opts, 'stateValue')
    return this.updateAnnotationKey(opts);
  }

  updateAnnotationKey(opts) {
    assert.ok(opts.resourceType, `Property 'resourceType' is required to update annotation key`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to update annotation key`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to update annotation key`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to update annotation key`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to update annotation key`);
    assert.ok(opts.key, `Property 'key' is required to update annotation key`);
    assert.ok(opts.value, `Property 'value' is required to update annotation key`);
    logger.debug(`Updating annotation key: ${opts.key} of resource: ` +
      `${opts.resourceType}/${opts.resourceId} for annotation ` +
      `${opts.annotationName}/${opts.annotationType}/${opts.annotationId}`);
    const annotationFolderName = this.getAnnotationFolderName(
      opts.resourceType, opts.resourceId, opts.annotationName, opts.annotationType, opts.annotationId);
    const annotationKey = `${annotationFolderName}/${opts.key}`;
    return etcd.put(annotationKey).value(opts.value);
  }

  getAnnotationKey(resourceType, resourceId, annotationName, annotationType, annotationId, key) {
    const annotationFolderName = this.getAnnotationFolderName(resourceType, resourceId, annotationName, annotationType, annotationId);
    logger.debug(`Getting annotation key: ${key} for ${annotationFolderName}`);
    const annotationKey = `${annotationFolderName}/${key}`;
    return etcd.get(annotationKey).string();
  }

  getAnnotationState(resourceType, resourceId, annotationName, annotationType, annotationId) {
    return this.getAnnotationKey(resourceType, resourceId, annotationName, annotationType, annotationId, CONST.ANNOTATION_KEYS.STATE);
  }
}

module.exports = Etcd3EventMeshServer;