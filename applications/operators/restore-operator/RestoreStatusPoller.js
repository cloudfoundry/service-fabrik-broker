'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const CONST = require('../../common/constants');
const logger = require('../../common/logger');
const catalog = require('../../common/models').catalog;
const config = require('../../common/config');
const RestoreService = require('./');
const utils = require('../../common/utils');
const EventLogInterceptor = require('../../common/EventLogInterceptor');
const BaseStatusPoller = require('../BaseStatusPoller');

class RestoreStatusPoller extends BaseStatusPoller {
  constructor() {
    super({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
      validStateList: [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS, CONST.APISERVER.RESOURCE_STATE.ABORTING],
      validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED, CONST.API_SERVER.WATCH_EVENT.MODIFIED],
      pollInterval: config.backup.backup_restore_status_check_every
    });
  }
  getStatus(resourceBody, intervalId) {
    const response = _.get(resourceBody, 'status.response');
    const changedOptions = _.get(resourceBody, 'spec.options');
    logger.debug('Getting restore status with the following options and response:', changedOptions, response);
    const plan = catalog.getPlan(changedOptions.plan_id);
    const restore_opts = {
      context: changedOptions.context,
      agent_ip: response.agent_ip,
      instance_guid: changedOptions.instance_guid,
      restore_guid: changedOptions.restore_guid
    };
    return RestoreService.createService(plan)
      .then(restoreService => restoreService
        .getRestoreOperationState(restore_opts)
        .then(operationStatusResponse => {
          logger.debug(`Got restore operation response for guid ${changedOptions.restore_guid}`, operationStatusResponse);
          return Promise
            .try(() => eventmesh.apiServerClient.patchResource({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
              resourceId: changedOptions.restore_guid,
              status: {
                response: operationStatusResponse
              }
            }))
            .then(() => {
              if (utils.isServiceFabrikOperationFinished(operationStatusResponse.state)) {
                return eventmesh.apiServerClient.patchResource({
                  resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.RESTORE,
                  resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_RESTORE,
                  resourceId: changedOptions.restore_guid,
                  status: {
                    state: operationStatusResponse.state
                  }
                })
                  .then(() => {
                    logger.debug('Clearing Restore Task Poller:', resourceBody.metadata.name);
                    this.clearPoller(resourceBody.metadata.name, intervalId);
                    _.set(restore_opts, 'user.name', changedOptions.username);
                    return this._logEvent(restore_opts, CONST.OPERATION_TYPE.RESTORE, operationStatusResponse);
                  });
              }
            });
        })
      );
  }

  _logEvent(instanceInfo, operation, operationStatusResponse) {
    const eventLogger = EventLogInterceptor.getInstance(config.external.event_type, 'external');
    const check_res_body = true;
    const resp = {
      statusCode: 200,
      body: operationStatusResponse
    };
    if (CONST.URL[operation]) {
      return eventLogger.publishAndAuditLogEvent(CONST.URL[operation], CONST.HTTP_METHOD.POST, instanceInfo, resp, check_res_body);
    }
  }
}

module.exports = RestoreStatusPoller;
