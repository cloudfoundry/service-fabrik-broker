'use strict';

const Promise = require('bluebird');
const { catalog } = require('@sf/models');
const { apiServerClient } = require('@sf/eventmesh');
const logger = require('@sf/logger');
const {
  CONST,
  commonFunctions: {
    buildErrorJson
  }

} = require('@sf/common-utils');
const { initializeEventListener } = require('@sf/event-logger');
const config = require('@sf/app-config');
const BackupService = require('./');
const BaseOperator = require('../BaseOperator');
require('../../../data-access-layer/db/DBManager');

class DefaultBackupOperator extends BaseOperator {

  init() {
    initializeEventListener(config.external, 'external');
    const validStateList = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE, CONST.OPERATION.ABORT, CONST.APISERVER.RESOURCE_STATE.DELETE];
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP)
      .then(() => this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR)) // creating director resource CRD as well, as during backup it is needed.
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, validStateList));
  }

  processRequest(changeObjectBody) {
    return Promise.try(() => {
      if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
        return DefaultBackupOperator._processBackup(changeObjectBody);
      } else if (changeObjectBody.status.state === CONST.OPERATION.ABORT) {
        return DefaultBackupOperator._processAbort(changeObjectBody);
      } else if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
        return DefaultBackupOperator._processDelete(changeObjectBody);
      }
    })
      .catch(err => {
        logger.error(`Error occurred in processing request ${changeObjectBody.status.state} for guid ${changeObjectBody.metadata.name} by DefaultBackupOperator`, err);
        return apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
          resourceId: changeObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            response: {
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              description: err.message
            },
            error: buildErrorJson(err)
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
    return apiServerClient.getOptions({
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
    return apiServerClient.getOptions({
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

module.exports = DefaultBackupOperator;
