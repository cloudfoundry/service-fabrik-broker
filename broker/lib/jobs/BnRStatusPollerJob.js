'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const BaseJob = require('./BaseJob');
const CONST = require('../constants');
const ScheduleManager = require('./ScheduleManager');
const utils = require('../utils');
const logger = require('../logger');
const errors = require('../errors');
const DeploymentAlreadyLocked = errors.DeploymentAlreadyLocked;
const config = require('../config');
const bosh = require('../../../data-access-layer/bosh');
const catalog = require('../models').catalog;
const BackupService = require('../../../managers/backup-manager');
const eventmesh = require('../../../eventmesh');
const lockManager = eventmesh.lockManager;
const EventLogInterceptor = require('../../../common/EventLogInterceptor');

class BnRStatusPollerJob extends BaseJob {
  constructor() {
    super();
  }

  static run(job, done) {
    job.__started_At = new Date();
    const options = job.attrs.data;
    logger.info(`-> Starting BnRStatusPollerJob -  name: ${options[CONST.JOB_NAME_ATTRIB]}
          - operation: ${options.operation} - with options: ${JSON.stringify(options)} `);
    if (!_.get(options, 'operation_details.instance_guid') || !_.get(options, 'type') ||
      !_.get(options, 'operation') || !_.get(options, 'operation_details.backup_guid') ||
      !_.get(options, 'operation_details.tenant_id') || !_.get(options, 'operation_details.plan_id') ||
      !_.get(options, 'operation_details.agent_ip') || !_.get(options, 'operation_details.started_at') ||
      !_.get(options, 'operation_details.deployment') || !_.get(options, 'operation_details.service_id')) {
      const msg = `BnR status poller cannot be initiated as the required mandatory params 
        (instance_guid | type | operation | backup_guid | tenant_id | plan_id | agent_ip | 
          started_at | deployment | service_id) is empty : ${JSON.stringify(options)}`;
      logger.error(msg);
      return this.runFailed(new errors.BadRequest(msg), {}, job, done);
    } else if (_.get(options, 'operation') !== CONST.OPERATION_TYPE.BACKUP) {
      const msg = `Operation polling not supported for operation - ${options.operation}`;
      logger.error(msg);
      const err = {
        statusCode: `ERR_${options.operation.toUpperCase()}_NOT_SUPPORTED`,
        statusMessage: msg
      };
      return this.runFailed(err, {}, job, done);
    } else {
      //modify the first argument here based on implementation of the function
      return this.checkOperationCompletionStatus(job.attrs.data)
        .then(operationStatusResponse => this.runSucceeded(operationStatusResponse, job, done))
        .catch(err => {
          logger.error(`Error occurred while running operation ${options.operation} status poller for instance ${_.get(options, 'instance_guid')}.`, err);
          return this.runFailed(err, {}, job, done);
        });
    }
  }

  static checkOperationCompletionStatus(job_data) {
    logger.info('Checking Operation Completion Status for :', job_data);
    const operationName = job_data.operation;
    const instanceInfo = job_data.operation_details;
    const instance_guid = instanceInfo.instance_guid;
    const backup_guid = instanceInfo.backup_guid;
    const deployment = instanceInfo.deployment;
    const plan = catalog.getPlan(instanceInfo.plan_id);
    return Promise.try(() => {
        if (operationName === CONST.OPERATION_TYPE.BACKUP) {
          return lockManager.lock(instance_guid, {
              lockedResourceDetails: {
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
                resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
                resourceId: backup_guid,
                operation: CONST.OPERATION_TYPE.BACKUP
              }
            })
            .catch(err => {
              if (err instanceof DeploymentAlreadyLocked) {
                logger.info(`Proceeding as lock is already acquired for the resource: ${instance_guid}`);
              } else {
                throw err;
              }
            })
            .then(() => {
              return BackupService.createService(plan)
                .then(backupService => backupService.getOperationState(CONST.OPERATION_TYPE.BACKUP, instanceInfo));
            });
        }
      })
      .then(operationStatusResponse => {
        operationStatusResponse.jobCancelled = false;
        operationStatusResponse.operationTimedOut = false;
        operationStatusResponse.operationFinished = false;
        if (utils.isServiceFabrikOperationFinished(operationStatusResponse.state)) {
          operationStatusResponse.operationFinished = true;
          return operationStatusResponse;
        } else {
          logger.info(`Instance ${instance_guid} ${operationName} for backup guid ${backup_guid} still in-progress - `, operationStatusResponse);
          const currentTime = new Date();
          const backupTriggeredDuration = (currentTime - new Date(instanceInfo.started_at)) / 1000;
          return Promise
            .try(() => eventmesh
              .apiServerClient
              .patchOperationResponse({
                operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
                operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
                operationId: instanceInfo.backup_guid,
                value: _.omit(operationStatusResponse, 'jobCancelled', 'operationTimedOut', 'operationFinished')
              }))
            .then(() => bosh.director.getDirectorConfig(instanceInfo.deployment))
            .then(directorConfig => {
              const lockDeploymentMaxDuration = directorConfig.lock_deployment_max_duration;
              if (backupTriggeredDuration > lockDeploymentMaxDuration) {
                //Operation timed out
                if (!instanceInfo.abortStartTime) {
                  //Operation not aborted. Aborting operation and with abort start time
                  // re-registering statupoller job
                  let abortStartTime = new Date().toISOString();
                  instanceInfo.abortStartTime = abortStartTime;
                  return BackupService.createService(plan)
                    .then(backupService => backupService.abortLastBackup(instanceInfo, true))
                    .then(() => BackupService.registerBnRStatusPoller(job_data, instanceInfo))
                    .then(() => {
                      operationStatusResponse.state = CONST.OPERATION.ABORTING;
                      return operationStatusResponse;
                    });
                } else {
                  // Operation aborted
                  const currentTime = new Date();
                  const abortDuration = (currentTime - new Date(instanceInfo.abortStartTime));
                  if (abortDuration < config.backup.abort_time_out) {
                    logger.info(`${operationName} abort is still in progress on : ${deployment} for guid : ${backup_guid}`);
                    operationStatusResponse.state = CONST.OPERATION.ABORTING;
                  } else {
                    operationStatusResponse.state = CONST.OPERATION.ABORTED;
                    logger.info(`Abort ${operationName} timed out on : ${deployment} for guid : ${backup_guid}. Flagging ${operationName} operation as complete`);
                    operationStatusResponse.operationTimedOut = true;
                    operationStatusResponse.operationFinished = true;
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
      .then(operationStatusResponse => operationStatusResponse.operationFinished ?
        this.doPostFinishOperation(operationStatusResponse, operationName, instanceInfo) : operationStatusResponse
      )
      .catch(err => {
        logger.error(`Caught error while checking for operation completion status:`, err);
        throw err;
      });
  }
  static doPostFinishOperation(operationStatusResponse, operationName, instanceInfo) {
    return Promise
      .try(() => eventmesh.apiServerClient.updateOperationState({
        operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
        operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
        operationId: instanceInfo.backup_guid,
        stateValue: operationStatusResponse.state
      }))
      .then(() => this._logEvent(instanceInfo, operationName, operationStatusResponse))
      .then(() => ScheduleManager.cancelSchedule(`${instanceInfo.deployment}_${operationName}_${instanceInfo.backup_guid}`, CONST.JOB.BNR_STATUS_POLLER))
      .then(() => {
        if (operationStatusResponse.operationTimedOut) {
          const msg = `Deployment ${instanceInfo.instance_guid} ${operationName} with backup guid ${instanceInfo.backup_guid} exceeding timeout time
    ${config.backup.backup_restore_status_poller_timeout / 1000 / 60} (mins). Stopping status check`;
          logger.error(msg);
        } else {
          logger.info(`Instance ${instanceInfo.instance_guid} ${operationName} for backup guid ${instanceInfo.backup_guid} completed -`, operationStatusResponse);
        }
        operationStatusResponse.jobCancelled = true;
        return operationStatusResponse;
      });
  }

  static _logEvent(instanceInfo, operation, operationStatusResponse) {
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
module.exports = BnRStatusPollerJob;