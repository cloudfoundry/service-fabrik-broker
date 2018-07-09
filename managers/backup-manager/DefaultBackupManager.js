'use strict';

const Promise = require('bluebird');
const catalog = require('../../broker/lib/models/catalog');
const eventmesh = require('../../eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const bm = require('./');
const BaseManager = require('../BaseManager');
const DBManager = require('../../broker/lib/fabrik/DBManager');

/* jshint nonew:false */
new DBManager(); //to start the BnRStatusPoller

class DefaultBackupManager extends BaseManager {

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
    return eventmesh.apiServerClient.getOperationOptions({
        resourceId: changedOptions.instance_guid,
        operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
        operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
        operationId: changedOptions.guid
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
    return eventmesh.apiServerClient.getOperationOptions({
        resourceId: changedOptions.instance_guid,
        operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
        operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
        operationId: changedOptions.guid
      })
      .then(options => {
        return Promise.try(() => {
          const plan = catalog.getPlan(options.plan_id);
          return bm.createService(plan);
        }).then(manager => manager.deleteBackup(options));
      });
  }
}

const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.OPERATION.ABORT},${CONST.APISERVER.RESOURCE_STATE.DELETE})`;
const defaultBackupManager = new DefaultBackupManager();
defaultBackupManager.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, queryString);
module.exports = defaultBackupManager;