'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const { apiServerClient } = require('@sf/eventmesh');
const {
  CONST,
  commonFunctions: {
    buildErrorJson,
    encodeBase64
  }
} = require('@sf/common-utils');
const logger = require('@sf/logger');
const BaseOperator = require('../BaseOperator');
const VirtualHostService = require('./VirtualHostService');

class VirtualHostBindOperator extends BaseOperator {

  init() {
    const validStateList = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE, CONST.APISERVER.RESOURCE_STATE.DELETE];
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.BIND, CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND, validStateList));
  }

  processRequest(changeObjectBody) {
    return Promise.try(() => {
      if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
        return this._processBind(changeObjectBody);
      } else if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
        return this._processUnbind(changeObjectBody);
      }
    })
      .catch(Error, err => {
        logger.error('Error occurred in processing request by VirtualHostBindOperator', err);
        return apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND,
          resourceId: changeObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: buildErrorJson(err)
          }
        });
      });
  }

  _processBind(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    const instance_guid = _.get(changeObjectBody, 'metadata.labels.instance_guid');
    logger.info('Triggering bind for virtualhost with the following options:', changedOptions);
    return VirtualHostService.createVirtualHostService(instance_guid, changedOptions)
      .then(virtualHostService => virtualHostService.bind(changedOptions))
      .then(response => {
        const encodedResponse = encodeBase64(response);
        return apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND,
          resourceId: changeObjectBody.metadata.name,
          status: {
            response: encodedResponse,
            state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
          }
        });
      });
  }
  _processUnbind(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    const instance_guid = _.get(changeObjectBody, 'metadata.labels.instance_guid');
    logger.info('Triggering unbind for virtualhost with the following options:', changedOptions);
    return VirtualHostService.createVirtualHostService(instance_guid, changedOptions)
      .then(virtualHostService => virtualHostService.unbind(changedOptions))
      .then(() => apiServerClient.deleteResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BIND,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.VIRTUALHOST_BIND,
        resourceId: changeObjectBody.metadata.name
      }));
  }
}

module.exports = VirtualHostBindOperator;
