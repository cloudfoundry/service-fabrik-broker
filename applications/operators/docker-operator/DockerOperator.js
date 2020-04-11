'use strict';

const assert = require('assert');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const utils = require('../../common/utils');
const BaseOperator = require('../BaseOperator');
const DockerService = require('./DockerService');
const errors = require('../../common/errors');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;

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
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
          resourceId: changeObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: utils.buildErrorJson(err)
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
      .then(response => eventmesh.apiServerClient.updateResource({
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
      .then(response => eventmesh.apiServerClient.updateResource({
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
      .then(() => eventmesh.apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        resourceId: changeObjectBody.metadata.name
      }))
      .catch(ServiceInstanceNotFound, () => eventmesh.apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        resourceId: changeObjectBody.metadata.name
      }));
  }
}

module.exports = DockerOperator;
