'use strict';

const Promise = require('bluebird');
const logger = require('../../common/logger');
const eventmesh = require('../../data-access-layer/eventmesh');
const catalog = require('../../common/models/catalog');
const utils = require('../../common/utils');
const CONST = require('../../common/constants');
const BaseOperator = require('../BaseOperator');
const RestoreService = require('./');

class DefaultRestoreManager extends BaseOperator {

  init() {
    const validStateList = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE, CONST.OPERATION.ABORT, CONST.APISERVER.RESOURCE_STATE.DELETE];
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.RESTORE, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE)
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.RESTORE, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, validStateList));
  }

  processRequest(requestObjectBody) {
    return Promise.try(() => {
        if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
          return DefaultRestoreManager._processRestore(requestObjectBody);
        } else if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.ABORT) {
          return DefaultRestoreManager._processAbort(requestObjectBody);
        }
      })
      .catch(err => {
        logger.error('Error occurred in processing request by DefaultRestoreManager', err);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
          resourceId: requestObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: utils.buildErrorJson(err)
          }
        });
      });
  }

  static _processRestore(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering restore with the following options:', changedOptions);
    const plan = catalog.getPlan(changedOptions.plan_id);
    return RestoreService.createService(plan)
      .then(service => service.startRestore(changedOptions));
  }

  static _processAbort(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering abort restore with the following options:', changedOptions);
    const plan = catalog.getPlan(changedOptions.plan_id);
    return RestoreService.createService(plan)
      .then(service => service.abortLastRestore(changedOptions));
  }

}
module.exports = DefaultRestoreManager;