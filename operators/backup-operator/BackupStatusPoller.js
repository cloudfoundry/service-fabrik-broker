'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const cf = require('../../data-access-layer/cf');
const CONST = require('../../common/constants');
const logger = require('../../common/logger');
const config = require('../../common/config');
const utils = require('../../common/utils');
const retry = utils.retry;
const catalog = require('../../common/models').catalog;
const EventLogInterceptor = require('../../common/EventLogInterceptor');
const BackupService = require('./BackupService');
const BaseStatusPoller = require('../BaseStatusPoller');
const AssertionError = assert.AssertionError;

class BackupStatusPoller extends BaseStatusPoller {
  constructor() {
    super({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
      validStateList: [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS, CONST.APISERVER.RESOURCE_STATE.ABORTING],
      validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED, CONST.API_SERVER.WATCH_EVENT.MODIFIED],
      pollInterval: config.backup.backup_restore_status_check_every
    });
  }

  checkOperationCompletionStatus(opts) {
    assert.ok(_.get(opts, 'instance_guid'), `Argument 'opts.instance_guid' is required to start polling for backup`);
    assert.ok(_.get(opts, 'backup_guid'), `Argument 'opts.backup_guid' is required to start polling for backup`);
    assert.ok(_.get(opts, 'plan_id'), `Argument 'opts.plan_id' is required to start polling for backup`);
    assert.ok(_.get(opts, 'started_at'), `Argument 'opts.started_at' is required to start polling for backup`);
    assert.ok(_.get(opts, 'deployment'), `Argument 'opts.deployment' is required to start polling for backup`);

    logger.info('Checking Operation Completion Status for :', opts);
    const operationName = CONST.OPERATION_TYPE.BACKUP;
    const instance_guid = opts.instance_guid;
    const backup_guid = opts.backup_guid;
    const plan = catalog.getPlan(opts.plan_id);
    const deployment = opts.deployment;

    return BackupService.createService(plan)
      .then(backupService => backupService.getOperationState(CONST.OPERATION_TYPE.BACKUP, opts))
      .then(operationStatusResponse => {
        if (utils.isServiceFabrikOperationFinished(operationStatusResponse.state)) {
          return operationStatusResponse;
        } else {
          logger.info(`Instance ${instance_guid} ${operationName} for backup guid ${backup_guid} still in-progress - `, operationStatusResponse);
          const currentTime = new Date();
          const backupTriggeredDuration = (currentTime - new Date(opts.started_at)) / 1000;
          return Promise
            .try(() => eventmesh
              .apiServerClient
              .patchResource({
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
                resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
                resourceId: opts.backup_guid,
                status: {
                  response: operationStatusResponse
                }
              }))
            .then(() => {
              const lockDeploymentMaxDuration = eventmesh.lockManager.getLockTTL(operationName);
              if (backupTriggeredDuration > lockDeploymentMaxDuration) {
                //Operation timed out
                if (!opts.abortStartTime) {
                  //Operation not aborted. Aborting operation and with abort start time
                  let abortStartTime = new Date().toISOString();
                  return eventmesh.apiServerClient.patchResource({
                      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
                      resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
                      resourceId: opts.backup_guid,
                      status: {
                        state: CONST.APISERVER.RESOURCE_STATE.ABORT,
                        response: {
                          abortStartTime: abortStartTime
                        }
                      }
                    })
                    .then(() => {
                      operationStatusResponse.state = CONST.OPERATION.ABORTING;
                      return operationStatusResponse;
                    });
                } else {
                  // Operation aborted
                  const currentTime = new Date();
                  const abortDuration = (currentTime - new Date(opts.abortStartTime));
                  if (abortDuration < config.backup.abort_time_out) {
                    logger.info(`${operationName} abort is still in progress on : ${deployment} for guid : ${backup_guid}`);
                    operationStatusResponse.state = CONST.OPERATION.ABORTING;
                  } else {
                    operationStatusResponse.state = CONST.OPERATION.ABORTED;
                    logger.info(`Abort ${operationName} timed out on : ${deployment} for guid : ${backup_guid}. Flagging ${operationName} operation as complete`);
                  }
                  return operationStatusResponse;
                }
              } else {
                // Backup not timedout and still in-porogress
                return operationStatusResponse;
              }
            });
        }
      })
      .then(operationStatusResponse => utils.isServiceFabrikOperationFinished(operationStatusResponse.state) ?
        this.doPostFinishOperation(operationStatusResponse, operationName, opts)
        .tap(() => {
          const RUN_AFTER = config.scheduler.jobs.reschedule_delay;
          let retryDelayInMinutes;
          if ((RUN_AFTER.toLowerCase()).indexOf('minutes') !== -1) {
            retryDelayInMinutes = parseInt(/^[0-9]+/.exec(RUN_AFTER)[0]);
          }
          let retryInterval = utils.getCronWithIntervalAndAfterXminute(plan.service.backup_interval || 'daily', retryDelayInMinutes);
          if (operationStatusResponse.state === CONST.OPERATION.FAILED) {
            const options = {
              instance_id: instance_guid,
              repeatInterval: retryInterval,
              type: CONST.BACKUP.TYPE.ONLINE
            };
            return retry(() => cf.serviceFabrikClient.scheduleBackup(options), {
              maxAttempts: 3,
              minDelay: 500
            });
          }
        }) : operationStatusResponse
      )
      .catch(err => {
        logger.error(`Caught error while checking for backup operation completion status for guid ${backup_guid}:`, err);
        throw err;
      });
  }
  doPostFinishOperation(operationStatusResponse, operationName, opts) {
    return Promise
      .try(() => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: opts.backup_guid,
        status: {
          'state': operationStatusResponse.state
        }
      }))
      .then(() => this._logEvent(opts, operationName, operationStatusResponse))
      .then(() => {
        if (operationStatusResponse.operationTimedOut) {
          const msg = `Deployment ${opts.instance_guid} ${operationName} with backup guid ${opts.backup_guid} exceeding timeout time
        ${config.backup.backup_restore_status_poller_timeout / 1000 / 60} (mins). Stopping status check`;
          logger.error(msg);
        } else {
          logger.info(`Instance ${opts.instance_guid} ${operationName} for backup guid ${opts.backup_guid} completed -`, operationStatusResponse);
        }
        return operationStatusResponse;
      });
  }

  _logEvent(opts, operation, operationStatusResponse) {
    const eventLogger = EventLogInterceptor.getInstance(config.external.event_type, 'external');
    const check_res_body = true;
    const resp = {
      statusCode: 200,
      body: operationStatusResponse
    };
    if (CONST.URL[operation]) {
      return eventLogger.publishAndAuditLogEvent(CONST.URL[operation], CONST.HTTP_METHOD.POST, opts, resp, check_res_body);
    }
  }
  getStatus(resourceBody, intervalId) {
    const response = _.get(resourceBody, 'status.response');
    const backupGuid = resourceBody.metadata.name;
    const instanceInfo = _.chain(response)
      .pick('tenant_id', 'backup_guid', 'instance_guid', 'agent_ip', 'service_id', 'plan_id', 'deployment', 'started_at', 'abortStartTime')
      .value();
    return this.checkOperationCompletionStatus(instanceInfo)
      .then(operationStatusResponse => {
        if (utils.isServiceFabrikOperationFinished(operationStatusResponse.state)) {
          this.clearPoller(backupGuid, intervalId);
        }
      })
      .catch(AssertionError, err => {
        logger.error('Error occured while polling for backup, marking backup as failed', err);
        this.clearPoller(backupGuid, intervalId);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
          resourceId: backupGuid,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            error: utils.buildErrorJson(err)
          }
        });
      });
  }
}

module.exports = BackupStatusPoller;