'use strict';

const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const utils = require('../../common/utils');
const CONST = require('../../common/constants');
const BaseOperator = require('../BaseOperator');
const VirtualHostService = require('./VirtualHostService');

class VirtualHostOperator extends BaseOperator {

  init() {
    const validStateList = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE, CONST.APISERVER.RESOURCE_STATE.UPDATE, CONST.APISERVER.RESOURCE_STATE.DELETE];
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST, validStateList));
  }

  processRequest(changeObjectBody) {
    return Promise.try(() => {
        if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
          return this._processCreate(changeObjectBody);
        } else if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.UPDATE) {
          return this._processUpdate(changeObjectBody);
        } else if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
          return this._processDelete(changeObjectBody);
        }
      })
      .catch(Error, (err) => {
        logger.error('Error occurred in processing request by VirtualHostOperator', err);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST,
          resourceId: changeObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: utils.buildErrorJson(err)
          }
        });
      });
  }

  _processCreate(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering virtualhost create with the following options:', changedOptions);
    return VirtualHostService.createVirtualHostService(changeObjectBody.metadata.name, changedOptions)
      .then(virtualHostService => virtualHostService.create())
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }

  _processUpdate(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering virtualhost update with the following options:', changedOptions);
    return VirtualHostService.createVirtualHostService(changeObjectBody.metadata.name, changedOptions)
      .then(virtualHostService => virtualHostService.update())
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }

  _processDelete(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering virtualhost delete with the following options:', changedOptions);
    return VirtualHostService.createVirtualHostService(changeObjectBody.metadata.name, changedOptions)
      .then(virtualHostService => virtualHostService.delete())
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }


}

module.exports = VirtualHostOperator;