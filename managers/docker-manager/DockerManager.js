'use strict';

const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const utils = require('../../common/utils');
const BaseManager = require('../BaseManager');
const DockerService = require('./DockerService');
const errors = require('../../common/errors');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;

class DockerManager extends BaseManager {

  init() {
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.APISERVER.RESOURCE_STATE.UPDATE},${CONST.APISERVER.RESOURCE_STATE.DELETE})`;
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, queryString));
  }

  processRequest(requestObjectBody) {
    return Promise.try(() => {
        if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
          return this._processCreate(requestObjectBody);
        } else if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.UPDATE) {
          return this._processUpdate(requestObjectBody);
        } else if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
          return this._processDelete(requestObjectBody);
        }
      })
      .catch(err => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        resourceId: requestObjectBody.metadata.name,
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.FAILED,
          lastOperation: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            description: err.message
          },
          error: utils.buildErrorJson(err)
        }
      }));
  }

  _processCreate(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Creating docker resource with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DockerService.createDockerService(changeObjectBody.metadata.name, changedOptions)
      .then(dockerService => dockerService.create(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }

  _processUpdate(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Updating docker resource with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DockerService.createDockerService(changeObjectBody.metadata.name, changedOptions)
      .then(dockerService => dockerService.update(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }

  _processDelete(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Deleting docker resource with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DockerService.createDockerService(changeObjectBody.metadata.name, changedOptions)
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

module.exports = DockerManager;