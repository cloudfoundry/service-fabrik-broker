'use strict';

const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const utils = require('../../common/utils');
const CONST = require('../../common/constants');
const BaseManager = require('../BaseManager');
const VirtualHostService = require('./VirtualHostService');

class VirtualHostBindManager extends BaseManager {

  init() {
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.APISERVER.RESOURCE_STATE.DELETE})`;
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND, queryString));
  }

  processRequest(requestObjectBody) {
    return Promise.try(() => {
        if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
          return this._processBind(requestObjectBody);
        } else if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
          return this._processUnbind(requestObjectBody);
        }
      })
      .catch(Error, (err) => {
        logger.error('Error occurred in processRequest', err);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND,
          resourceId: requestObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: utils.buildErrorJson(err)
          }
        });
      });
  }

  _processBind(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    const instance_guid = changeObjectBody.metadata.labels.instance_guid;
    logger.info('Triggering bind for virtualhost with the following options:', changedOptions);
    return VirtualHostService.createVirtualHostService(instance_guid, changedOptions)
      .then(virtualHostService => virtualHostService.bind(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND,
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
    logger.info('Triggering unbind for virtualhost with the following options:', changedOptions);
    return VirtualHostService.createVirtualHostService(instance_guid, changedOptions)
      .then(virtualHostService => virtualHostService.unbind(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND,
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      }));
  }
}

module.exports = VirtualHostBindManager;