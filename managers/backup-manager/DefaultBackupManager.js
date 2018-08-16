'use strict';

const Promise = require('bluebird');
const catalog = require('../../common/models/catalog');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const utils = require('../../common/utils');
const CONST = require('../../common/constants');
const BackupService = require('./');
const BaseManager = require('../BaseManager');
const DBManager = require('../../broker/lib/fabrik/DBManager');

/* jshint nonew:false */
new DBManager(); //to start the BnRStatusPoller

class DefaultBackupManager extends BaseManager {

  init() {
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.OPERATION.ABORT},${CONST.APISERVER.RESOURCE_STATE.DELETE})`;
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP)
      .then(() => this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR)) //creating director resource CRD as well, as during backup it is needed.
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, queryString));
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
    }).catch(err => {
      logger.error('Error occurred in processRequest', err);
      return eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: requestObjectBody.metadata.name,
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.FAILED,
          error: utils.buildErrorJson(err)
        }
      });
    });
  }

  static _processBackup(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering backup with the following options:', changedOptions);
    const plan = catalog.getPlan(changedOptions.plan_id);
    return BackupService.createService(plan)
      .then(service => service.startBackup(changedOptions));
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
          return BackupService.createService(plan);
        }).then(service => service.abortLastBackup(options));
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
          return BackupService.createService(plan);
        }).then(service => service.deleteBackup(options));
      });
  }
}

module.exports = DefaultBackupManager;