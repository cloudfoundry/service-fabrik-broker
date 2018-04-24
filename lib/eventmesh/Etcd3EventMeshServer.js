'use strict';

const config = require('../config');
const logger = require('../logger');
const CONST = require('../../lib/constants');
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
    const optionKey = `${serviceFolderName}/attributes`;
    logger.debug(`Registering Service ${serviceId} for resource ${resourceType}` +
      `with attributes: ${serviceAttributesValue} and plans: ${servicePlansValue}`);
    return etcd.put(optionKey).value(JSON.stringify(serviceAttributesValue))
      .then(() => {
        const plansKey = `${serviceFolderName}/plans`;
        return etcd.put(plansKey).value(JSON.stringify(servicePlansValue));
      });
  }

  getServiceAttributes(resourceType, serviceId) {
    const serviceFolderName = this.getServiceFolderName(resourceType, serviceId);
    const attrKey = `${serviceFolderName}/attributes`;
    logger.debug('Getting Service Attributes for serviceId:', serviceId);
    return etcd.get(attrKey).json();
  }

  getServicePlans(resourceType, serviceId) {
    logger.debug(`Getting Service plans for ${resourceType}/${serviceId}`);
    const serviceFolderName = this.getServiceFolderName(resourceType, serviceId);
    const attrKey = `${serviceFolderName}/plans`;
    return etcd.get(attrKey).json();
  }

  createResource(resourceType, resourceId, val) {
    logger.debug(`Creating Resource ${resourceType}/${resourceId}`);
    const resourceFolderName = this.getResourceFolderName(resourceType, resourceId);
    const optionKey = `${resourceFolderName}/options`;
    const statusKey = `${resourceFolderName}/state`;
    const lastOperationKey = `${resourceFolderName}/lastoperation`;
    return etcd.put(optionKey).value(val)
      .then(() => etcd.put(statusKey).value(CONST.RESOURCE_STATE.IN_QUEUE))
      .then(() => etcd.put(lastOperationKey).value(''));
  }

  updateResourceState(resourceType, resourceId, stateValue) {
    return this.checkValidState(stateValue)
      .then(() => this.updateResourceKey(resourceType, resourceId, 'state', stateValue));
  }

  updateResourceKey(resourceType, resourceId, key, value) {
    const resourceFolderName = this.getResourceFolderName(resourceType, resourceId);
    const statusKey = `${resourceFolderName}/${key}`;
    logger.debug(`Updating resource key: ${key} for ${resourceId}`);
    return etcd.put(statusKey).value(value);
  }

  getResourceKey(resourceType, resourceId, key) {
    logger.debug(`Getting resource key: ${key} for ${resourceType}/${resourceId}`);
    const resourceFolderName = this.getResourceFolderName(resourceType, resourceId);
    const statusKey = `${resourceFolderName}/${key}`;
    return etcd.get(statusKey).string();
  }

  getResourceState(resourceType, resourceId) {
    return this.getResourceKey(resourceType, resourceId, 'state');
  }

  registerWatcher(key, callback, isRecursive) {
    if (isRecursive === true) {
      logger.debug(`Registering reccursive watcher on prefix: ${key}`);
      return etcd.watch()
        .prefix(key)
        .create()
        .then(watcher => {
          watcher
            .on('put', callback);
        });
    } else {
      logger.debug(`Registering watcher on key: ${key}`);
      return etcd.watch()
        .key(key)
        .create()
        .then(watcher => {
          watcher
            .on('put', callback);
        });
    }
  }

  annotateResource(resourceType, resourceId, annotationName, operationType, opId, val) {
    const annotationFolderName = this.getAnnotationFolderName(resourceType, resourceId, annotationName, operationType, opId);
    const optionKey = `${annotationFolderName}/options`;
    logger.debug(`Annotating Resource ${resourceType}/${resourceId} for annotation: ${annotationName}`);
    return etcd.put(optionKey).value(val)
      .then(() => {
        const statusKey = `${annotationFolderName}/state`;
        return etcd.put(statusKey).value(CONST.RESOURCE_STATE.IN_QUEUE);
      });
  }

  updateAnnotationState(resourceType, resourceId, annotationName, operationType, opId, stateValue) {
    return this.updateAnnotationKey(resourceType, resourceId, annotationName, operationType, opId, 'state', stateValue);
  }

  updateAnnotationKey(resourceType, resourceId, annotationName, operationType, opId, key, value) {
    logger.debug(`Updating annotation key: ${key} of resource: ${resourceType}/${resourceId} for annotation ${annotationName}/${operationType}/${opId}`);
    const annotationFolderName = this.getAnnotationFolderName(resourceType, resourceId, annotationName, operationType, opId);
    const statusKey = `${annotationFolderName}/${key}`;
    return etcd.put(statusKey).value(value);
  }

  getAnnotationKey(resourceType, resourceId, annotationName, operationType, opId, key) {
    const annotationFolderName = this.getAnnotationFolderName(resourceType, resourceId, annotationName, operationType, opId);
    logger.debug(`Getting annotation key: ${key} for ${annotationFolderName}`);
    const statusKey = `${annotationFolderName}/${key}`;
    return etcd.get(statusKey).string();
  }

  getAnnotationState(resourceType, resourceId, annotationName, operationType, opId) {
    return this.getAnnotationKey(resourceType, resourceId, annotationName, operationType, opId, 'state');
  }

}

module.exports = Etcd3EventMeshServer;