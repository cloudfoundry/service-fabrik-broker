'use strict';

const Promise = require('bluebird');
const catalog = require('../../common/models/catalog');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const bm = require('./');
const BaseManager = require('../BaseManager');
const DBManager = require('../../broker/lib/fabrik/DBManager');

/* jshint nonew:false */
new DBManager(); //to start the BnRStatusPoller

class DefaultBackupManager extends BaseManager {

  init() {
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.OPERATION.ABORT},${CONST.APISERVER.RESOURCE_STATE.DELETE})`;
    return this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, queryString);
  }

  processRequest(requestObjectBody) {
    return Promise.try(() => {
      if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
        return DefaultBackupManager._processBackup(requestObjectBody);
      } else if (requestObjectBody.status.state === CONST.OPERATION.ABORT) {
        return DefaultBackupManager._processAbort(requestObjectBody);
      } else if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
        return DefaultBackupManager._processDelete(requestObjectBody);
      }
    });
  }

  static _processBackup(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering backup with the following options:', changedOptions);
    const plan = catalog.getPlan(changedOptions.plan_id);
    return bm.createService(plan)
      .then(manager => manager.startBackup(changedOptions));
  }

  static _processAbort(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    return eventmesh.apiServerClient.getOptions({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: changedOptions.guid
      })
      .then(options => {
        return Promise.try(() => {
          const plan = catalog.getPlan(options.plan_id);
          return bm.createService(plan);
        }).then(manager => manager.abortLastBackup(options));
      });
  }

  static _processDelete(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    return eventmesh.apiServerClient.getOptions({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: changedOptions.guid
      })
      .then(options => {
        return Promise.try(() => {
          const plan = catalog.getPlan(options.plan_id);
          return bm.createService(plan);
        }).then(manager => manager.deleteBackup(options));
      });
  }
}

module.exports = DefaultBackupManager;