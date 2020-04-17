'use strict';

const assert = require('assert');
const Promise = require('bluebird');
const { apiServerClient } = require('@sf/eventmesh');
const logger = require('@sf/logger');
const {
  CONST,
  commonFunctions: {
    buildErrorJson
  },
  errors: {
    ServiceInstanceNotFound
  }
} = require('@sf/common-utils');
const BaseOperator = require('../BaseOperator');
const DockerService = require('./DockerService');

class DockerOperator extends BaseOperator {

  init() {
    const validStateList = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE, CONST.APISERVER.RESOURCE_STATE.UPDATE, CONST.APISERVER.RESOURCE_STATE.DELETE];
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, validStateList));
  }

  processRequest(changeObjectBody) {

    return Promise.try(() => {
      switch (changeObjectBody.status.state) {
        case CONST.APISERVER.RESOURCE_STATE.IN_QUEUE:
          return this._processCreate(changeObjectBody);
        case CONST.APISERVER.RESOURCE_STATE.UPDATE:
          return this._processUpdate(changeObjectBody);
        case CONST.APISERVER.RESOURCE_STATE.DELETE:
          return this._processDelete(changeObjectBody);
        default:
          logger.error('Ideally it should never come to default state! There must be some error as the state is ', changeObjectBody.status.state);
          break;
      }
    })
      .catch(err => {
        logger.error('Error occurred in processing request by DockerOperator', err);
        return apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
          resourceId: changeObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: buildErrorJson(err)
          }
        });
      });
  }

  _processCreate(changeObjectBody) {
    assert.ok(changeObjectBody.metadata.name, 'Argument \'metadata.name\' is required to process the request');
    assert.ok(changeObjectBody.spec.options, 'Argument \'spec.options\' is required to process the request');
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    assert.ok(changedOptions.plan_id, 'Argument \'spec.options\' should have an argument plan_id to process the request');
    logger.info('Creating docker resource with the following options:', changedOptions);
    return DockerService.createInstance(changeObjectBody.metadata.name, changedOptions)
      .then(dockerService => dockerService.create(changedOptions))
      .then(response => apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED,
          appliedOptions: changedOptions
        }
      }));
  }

  _processUpdate(changeObjectBody) {
    assert.ok(changeObjectBody.metadata.name, 'Argument \'metadata.name\' is required to process the request');
    assert.ok(changeObjectBody.spec.options, 'Argument \'spec.options\' is required to process the request');
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    assert.ok(changedOptions.plan_id, 'Argument \'spec.options\' should have an argument plan_id to process the request');
    logger.info('Updating docker resource with the following options:', changedOptions);
    return DockerService.createInstance(changeObjectBody.metadata.name, changedOptions)
      .then(dockerService => dockerService.update(changedOptions))
      .then(response => apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED,
          appliedOptions: changedOptions
        }
      }));
  }

  _processDelete(changeObjectBody) {
    assert.ok(changeObjectBody.metadata.name, 'Argument \'metadata.name\' is required to process the request');
    assert.ok(changeObjectBody.spec.options, 'Argument \'spec.options\' is required to process the request');
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    assert.ok(changedOptions.plan_id, 'Argument \'spec.options\' should have an argument plan_id to process the request');
    logger.info('Deleting docker resource with the following options:', changedOptions);
    return DockerService.createInstance(changeObjectBody.metadata.name, changedOptions)
      .then(dockerService => dockerService.delete(changedOptions))
      .then(() => apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        resourceId: changeObjectBody.metadata.name
      }))
      .catch(ServiceInstanceNotFound, () => apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        resourceId: changeObjectBody.metadata.name
      }));
  }
}

module.exports = DockerOperator;
