'use strict';

const _ = require('lodash');
const assert = require('assert');
const config = require('../common/config');
const logger = require('../common/logger');
const CONST = require('../common/constants');
const EventMeshServer = require('./EventMeshServer');
const {
  Etcd3
} = require('etcd3');
const etcd = new Etcd3({
  hosts: config.etcd.url,
  credentials: {
    rootCertificate: Buffer.from(config.etcd.ssl.ca, 'utf8'),
    privateKey: Buffer.from(config.etcd.ssl.key, 'utf8'),
    certChain: Buffer.from(config.etcd.ssl.crt, 'utf8')
  }
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
    logger.debug(`Getting Service Attributes for serviceId:${serviceId} for resourceType ${resourceType}`);
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

  getResourceKeyValue(resourceType, resourceId, key) {
    logger.debug(`Getting resource key: ${key} for ${resourceType}/${resourceId}`);
    const resourceFolderName = this.getResourceFolderName(resourceType, resourceId);
    const resourceKey = `${resourceFolderName}/${key}`;
    return etcd.get(resourceKey).string();
  }

  getResourceState(resourceType, resourceId) {
    return this.getResourceKeyValue(resourceType, resourceId, CONST.RESOURCE_KEYS.STATE);
  }

  registerWatcher(key, callback, watchOnPrefix) {
    if (watchOnPrefix === true) {
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

  annotateResource(opts) {
    assert.ok(opts.resourceId, `Property 'resourceId' is required to annotate resource`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to annotate resource`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to annotate resource`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to annotate resource`);
    assert.ok(opts.val, `Property 'val' is required to annotate resource`);
    const annotationFolderName = this.getAnnotationFolderName(opts);
    const optionKey = `${annotationFolderName}/${CONST.ANNOTATION_KEYS.OPTIONS}`;
    logger.debug(`Creating Annotation ${annotationFolderName}`);
    return etcd.put(optionKey).value(opts.val)
      .then(() => {
        const statusKey = `${annotationFolderName}/${CONST.ANNOTATION_KEYS.STATE}`;
        return etcd.put(statusKey).value(CONST.RESOURCE_STATE.IN_QUEUE);
      });
  }

  updateAnnotationState(opts) {
    assert.ok(opts.resourceId, `Property 'resourceId' is required to update annotation state`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to update annotation state`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to update annotation state`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to update annotation state`);
    assert.ok(opts.stateValue, `Property 'stateValue' is required to update annotation state`);
    opts = _
      .chain(opts)
      .assign({
        key: CONST.ANNOTATION_KEYS.STATE,
        value: opts.stateValue
      })
      .omit('stateValue')
      .value();
    return this.updateAnnotationKey(opts);
  }

  updateLastAnnotation(opts) {
    assert.ok(opts.annotationName, `Property 'annotationName' is required to update annotation key`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to update annotation key`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to update annotation key`);
    assert.ok(opts.value, `Property 'value' is required to update annotation key`);
    return etcd.put(`${opts.annotationName}/${opts.annotationType}/${opts.resourceId}/last`).value(opts.value);
  }
  getLastAnnotation(opts) {
    assert.ok(opts.annotationName, `Property 'annotationName' is required to update annotation key`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to update annotation key`);
    assert.ok(opts.resourceId, `Property 'resourceId' is required to update annotation key`);
    return etcd.get(`${opts.annotationName}/${opts.annotationType}/${opts.resourceId}/last`).string();
  }
  updateAnnotationKey(opts) {
    assert.ok(opts.resourceId, `Property 'resourceId' is required to update annotation key`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to update annotation key`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to update annotation key`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to update annotation key`);
    assert.ok(opts.key, `Property 'key' is required to update annotation key`);
    assert.ok(opts.value, `Property 'value' is required to update annotation key`);
    const annotationFolderName = this.getAnnotationFolderName(opts);
    const annotationKey = `${annotationFolderName}/${opts.key}`;
    logger.debug(`Updating annotation key: ${annotationKey}`);
    return etcd.put(annotationKey).value(opts.value);
  }

  getAnnotationKeyValue(opts) {
    assert.ok(opts.resourceId, `Property 'resourceId' is required to get annotation key`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to get annotation key`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to get annotation key`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to get annotation key`);
    assert.ok(opts.key, `Property 'key' is required to get annotation key`);
    const annotationFolderName = this.getAnnotationFolderName(opts);
    logger.debug(`Getting annotation key: ${opts.key} for ${annotationFolderName}`);
    const annotationKey = `${annotationFolderName}/${opts.key}`;
    return etcd.get(annotationKey).string();
  }

  getAnnotationOptions(opts) {
    assert.ok(opts.resourceId, `Property 'resourceId' is required to get annotation state`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to get annotation state`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to get annotation state`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to get annotation state`);
    opts = _
      .chain(opts)
      .assign({
        key: 'options'
      })
      .value();
    return this.getAnnotationKeyValue(opts);
  }

  getAnnotationState(opts) {
    assert.ok(opts.resourceId, `Property 'resourceId' is required to get annotation state`);
    assert.ok(opts.annotationName, `Property 'annotationName' is required to get annotation state`);
    assert.ok(opts.annotationType, `Property 'annotationType' is required to get annotation state`);
    assert.ok(opts.annotationId, `Property 'annotationId' is required to get annotation state`);
    opts = _
      .chain(opts)
      .assign({
        key: CONST.ANNOTATION_KEYS.STATE
      })
      .value();
    return this.getAnnotationKeyValue(opts);
  }

}

module.exports = Etcd3EventMeshServer;