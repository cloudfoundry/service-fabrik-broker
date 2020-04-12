'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const { apiServerClient } = require('@sf/eventmesh');
const logger = require('@sf/logger');
const {
  CONST,
  errors: {
    Gone
  },
  commonFunctions: {
    buildErrorJson
  }
} = require('@sf/common-utils');
const BaseOperator = require('../BaseOperator');
const MTServiceFabrik = require('./MTServiceFabrik');

class MultitenancyOperator extends BaseOperator {

  constructor(resourceType, service) {
    super();
    this.service = service;
    this.resourceType = resourceType;
  }

  init() {
    const validStateList = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE, CONST.APISERVER.RESOURCE_STATE.UPDATE, CONST.APISERVER.RESOURCE_STATE.DELETE];
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, this.resourceType)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, this.resourceType, validStateList));
  }

  processRequest(changeObjectBody) {
    return Promise.try(() => {
      switch (changeObjectBody.status.state) {
        case CONST.APISERVER.RESOURCE_STATE.IN_QUEUE:
          return this._processCreate(changeObjectBody);
        case CONST.APISERVER.RESOURCE_STATE.DELETE:
          return this._processDelete(changeObjectBody);
        case CONST.APISERVER.RESOURCE_STATE.UPDATE:
          return this._processUpdate(changeObjectBody);
        default:
          logger.error('Ideally it should never come to default state! There must be some error as the state is ', changeObjectBody.status.state);
          break;
      }
    })
      .catch(Error, err => {
        logger.error('Error occurred in processing request by MultitenancyOperator', err);
        return apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: this.resourceType,
          resourceId: changeObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: buildErrorJson(err)
          }
        });
      });
  }

  _processCreate(changeObjectBody) {
    assert.ok(_.get(changeObjectBody, 'metadata.name'), 'Argument \'metadata.name\' is required to process the request');
    assert.ok(_.get(changeObjectBody, 'spec.options'), 'Argument \'spec.options\' is required to process the request');
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info(`Triggering create of resource '${this.resourceType}' with the following options: '${JSON.stringify(changedOptions)}`);
    const multitenancyService = MTServiceFabrik.getService(this.service);
    return multitenancyService.createInstance(changeObjectBody.metadata.name, changedOptions, this.resourceType)
      .then(multitenancyService => multitenancyService.create())
      .then(response => apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: this.resourceType,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }

  _processDelete(changeObjectBody) {
    assert.ok(_.get(changeObjectBody, 'metadata.name'), 'Argument \'metadata.name\' is required to process the request');
    assert.ok(_.get(changeObjectBody, 'spec.options'), 'Argument \'spec.options\' is required to process the request');
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info(`Triggering delete of resource:'${this.resourceType}' with the following options: '${JSON.stringify(changedOptions)}`);
    const multitenancyService = MTServiceFabrik.getService(this.service);
    return multitenancyService.createInstance(changeObjectBody.metadata.name, changedOptions, this.resourceType)
      .then(multitenancyService => multitenancyService.delete(changeObjectBody))
      .then(() => apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: this.resourceType,
        resourceId: changeObjectBody.metadata.name
      }))
      .catch(Gone, () => apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: this.resourceType,
        resourceId: changeObjectBody.metadata.name
      }));
  }

  _processUpdate(changeObjectBody) {
    assert.ok(_.get(changeObjectBody, 'metadata.name'), 'Argument \'metadata.name\' is required to process the request');
    assert.ok(_.get(changeObjectBody, 'spec.options'), 'Argument \'spec.options\' is required to process the request');
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info(`Triggering update of resource:'${this.resourceType}' with the following options: '${JSON.stringify(changedOptions)}`);
    const multitenancyService = MTServiceFabrik.getService(this.service);
    return multitenancyService.createInstance(changeObjectBody.metadata.name, changedOptions, this.resourceType)
      .then(multitenancyService => multitenancyService.update(changeObjectBody))
      .then(response => apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: this.resourceType,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }
}

module.exports = MultitenancyOperator;
