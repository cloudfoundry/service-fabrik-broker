'use strict';

const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const BaseManager = require('../BaseManager');
const DirectorService = require('./DirectorService');
const errors = require('../../common/errors');
const utils = require('../../common/utils');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;

class BOSHManager extends BaseManager {

  init() {
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.APISERVER.RESOURCE_STATE.UPDATE},${CONST.APISERVER.RESOURCE_STATE.DELETE})`;
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, queryString));
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
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
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
    logger.info('Creating deployment resource with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DirectorService.createDirectorService(changeObjectBody.metadata.name, changedOptions)
      .then(boshService => boshService.create(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
        }
      }));
  }

  _processUpdate(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Updating deployment resource with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DirectorService.createDirectorService(changeObjectBody.metadata.name, changedOptions)
      .then(boshService => boshService.update(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
        }
      }));
  }

  _processDelete(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Deleting deployment resource with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DirectorService.createDirectorService(changeObjectBody.metadata.name, changedOptions)
      .then(boshService => boshService.delete(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
        }
      })).catch(ServiceInstanceNotFound, () => eventmesh.apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: changeObjectBody.metadata.name
      }));
  }
}

module.exports = BOSHManager;