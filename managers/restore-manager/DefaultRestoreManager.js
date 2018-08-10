'use strict';

const Promise = require('bluebird');
const logger = require('../../common/logger');
const catalog = require('../../common/models/catalog');
const CONST = require('../../common/constants');
const BaseManager = require('../BaseManager');
const RestoreService = require('./');

class DefaultRestoreManager extends BaseManager {

  init() {
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.OPERATION.ABORT},${CONST.APISERVER.RESOURCE_STATE.DELETE})`;
    return this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.RESTORE, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE, queryString);
  }

  processRequest(requestObjectBody) {
    return Promise.try(() => {
      if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
        return DefaultRestoreManager._processRestore(requestObjectBody);
      } else if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.ABORT) {
        return DefaultRestoreManager._processAbort(requestObjectBody);
      }
    });
  }

  static _processRestore(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering restore with the following options:', changedOptions);
    const plan = catalog.getPlan(changedOptions.plan_id);
    return RestoreService.createService(plan)
      .then(rs => rs.startRestore(changedOptions));
  }

  static _processAbort(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering abort restore with the following options:', changedOptions);
    const plan = catalog.getPlan(changedOptions.plan_id);
  }

}
module.exports = DefaultRestoreManager;