'use strict';

const _ = require('lodash');
const BasePollerJob = require('./BasePollerJob');
const CONST = require('../constants');
const ScheduleManager = require('./ScheduleManager');
const utils = require('../utils');
const moment = require('moment');
const logger = require('../logger');
const errors = require('../errors');
const Promise = require('bluebird');
const config = require('../config');
const DirectorManager = require('../fabrik/DirectorManager');

class BnRStatusPollerJob extends BasePollerJob {
  constructor() {
    super();
  }

  static run(job, done) {
    job.__started_At = new Date();
    const options = job.attrs.data;
    logger.info(`-> Starting BnRStatusPollerJob -  name: ${job.attrs.data[CONST.JOB_NAME_ATTRIB]}
          - operation: ${options.operation} - with options: ${JSON.stringify(options)} `);
    if (!_.get(options, 'instance_guid') || !_.get(options, 'type') ||
      !_.get(options, 'operation') || !_.get(options, 'backup_guid')) {
      const msg = `BnR status poller cannot be initiated as the required mandatory params 
        (instance_guid | type | operation | backup_guid) is empty : ${JSON.stringify(options)}`;
      logger.error(msg);
      return this.runFailed(new errors.BadRequest(msg), {}, job, done);
    }
    else if (_.get(options, 'operation') !== 'backup' && _.get(options, 'operation') !== 'restore') {
      const msg = `Operation polling not supported for operation - ${options.operation}`;
      logger.error(msg);
      const err = {
        statusCode: `ERR_${options.operation.toUpperCase()}_NOT_SUPPORTED`,
        statusMessage: msg
      };
      return this.runFailed(err, {}, job, done);
    } else {
      //modify the first argument here based on implementation of the function
      return this.checkOperationCompletionStatus(options.token, job)
        .then(operationStatusResponse => this.runSucceeded(operationStatusResponse, job, done))
        .catch(err => {
          logger.error(`Error occurred while running operation ${options.operation} status poller for instance ${_.get(options, 'instance_guid')}.`, err);
          return this.runFailed(err, {}, job, done);
        });
    }
  }

  static checkOperationCompletionStatus(token, job) {

    const operationStartedAt = moment(new Date(job.attrs.data.started_at));
    const instanceGuid = job.attrs.data.instance_guid;
    const operationName = job.attrs.data.operation;
    const backupGuid = job.attrs.data.backup_guid;
    const planId = job.attrs.data.plan_id;
    const deployment = job.attrs.data.deployment;
    const instanceInfo = job.attrs.data;
    //const boshDirectorName = job.attrs.data.bosh_director;

    return Promise.try(() => {
      if (operationName === 'backup') {
        return this
          .getFabrikClient()
          .getInstanceBackupStatus(job.attrs.data, token);
      } else {
        throw new errors.BadRequest(`Operation ${operationName} not supported by BnR status poller.`);
      }
    })
      .then(operationStatusResponse => {
        operationStatusResponse.jobCancelled = false;
        operationStatusResponse.operationTimedOut = false;
        let operationFinished = false;
        if (utils.isServiceFabrikOperationFinished(operationStatusResponse.state)) {
          operationFinished = true;
        } else {
          logger.info(`Instance ${instanceGuid} ${operationName} for backup guid ${backupGuid} still in-progress - `, operationStatusResponse);
          const currTime = moment();
          // 'backup_restore_status_poller_timeout' config data might need to put in job data: operation specific
          // operation can be other than backup/restore : thought just for future reference
          const lock_deployment_max_duration = bosh.director.getDirectorConfig(instanceInfo.deployment).lock_deployment_max_duration;
          if (currTime.diff(operationStartedAt) > lock_deployment_max_duration) {
            if (!instanceInfo.abortStartTime) {
              abortStartTime = new Date();
              instanceInfo.abortStartTime = abortStartTime;
              DirectorManager.registerBnRStatusPoller(instanceInfo);
            } else {
              const currentTime = new Date();
              const abortDuration = (currentTime - instanceInfo.abortStartTime);
              if (abortDuration < config.backup.abort_time_out) {
                logger.info(`backup abort is still in progress on : ${deployment} for guid : ${backupGuid}`);
                operationStatusResponse.state = "aborting";//define in the constant
                return operationStatusResponse;
              } else {
                operationStatusResponse.state = CONST.OPERATION.ABORTED;
                logger.info(`Abort Backup timed out on : ${deployment} for guid : ${backup_guid}. Flagging backup operation as complete`);
                operationStatusResponse.operationTimedOut = true;
                operationFinished = true;
              }
            }
          } else {
            // Operation is still in progress.
            return operationStatusResponse;
          }
        }

        if (operationFinished) {
          this.unlockDeployment(job.attrs.data, operationStatusResponse);
          return ScheduleManager.cancelSchedule(`${instanceGuid}_${operationName}_${backupGuid}`, CONST.JOB.BNR_STATUS_POLLER)
            .then(() => {
              if (operationStatusResponse.operationTimedOut) {
                const msg = `Deployment ${instanceGuid} ${operationName} with backup guid ${backupGuid} exceeding timeout time 
              ${config.backup.backup_restore_status_poller_timeout / 1000 / 60} (mins). Stopping status check`;
                logger.error(msg);
              } else {
                logger.info(`Instance ${instanceGuid} ${operationName} for backup guid ${backupGuid} completed -`, operationStatusResponse);
              }
              operationStatusResponse.jobCancelled = true;
              return operationStatusResponse;
            });
        }

      })
  }
  static unlockDeployment(instanceInfo, operationStatusResponse) {
    const unlockOperation = new ServiceFabrikOperation('unlock', {
      instance_id: instanceInfo.instance_guid,
      isOperationSync: true,
      arguments: {
        description: _.get(operationStatusResponse, 'description')
      }
    });
    return unlockOperation
      .invoke()
      .then(() => {
        logger.info(`Unlocked deployment : ${instanceInfo.deployment} for backup_guid : ${instanceInfo.backup_guid} successfully. Poller stopped.`);
        const eventLogger = EventLogInterceptor.getInstance(config.external.event_type, 'external');
        const check_res_body = true;
        const resp = {
          statusCode: 200,
          body: operationStatusResponse
        };
        if (CONST.URL[operation]) {
          eventLogger.publishAndAuditLogEvent(CONST.URL[operation], CONST.HTTP_METHOD.POST, instanceInfo, resp, check_res_body);
        }
      })
      .catch(err => logger.error(`Error occurred while unlocking deployment: ${instanceInfo.deployment} for ${operation} with guid : ${instanceInfo.backup_guid}`, err));
  }
}



module.exports = BnRStatusPollerJob;