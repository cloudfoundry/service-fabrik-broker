'use strict';

const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const BaseManager = require('../BaseManager');
const DirectorService = require('./DirectorService');

class BOSHBindManager extends BaseManager {

  init() {
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.APISERVER.RESOURCE_STATE.DELETE})`;
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND, queryString));
  }

  processRequest(requestObjectBody) {
    return Promise.try(() => {
        if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
          return this._processBind(requestObjectBody);
        } else if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
          return this._processUnbind(requestObjectBody);
        }
      })
      .catch(err => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
        resourceId: requestObjectBody.metadata.name,
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.FAILED,
          lastOperation: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            description: err.message
          }
        }
      }));
  }

  _processBind(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    const instance_guid = changeObjectBody.metadata.labels.instance_guid;
    logger.info('Triggering bind with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DirectorService.createDirectorService(instance_guid, changedOptions)
      .then(boshService => boshService.bind(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }
  _processUnbind(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    const instance_guid = changeObjectBody.metadata.labels.instance_guid;
    logger.info('Triggering unbind with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DirectorService.createDirectorService(instance_guid, changedOptions)
      .then(boshService => boshService.unbind(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR_BIND,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }


}

module.exports = BOSHBindManager;