'use strict';

const _ = require('lodash');
const logger = require('../logger');
const config = require('../config');
const BaseJob = require('./BaseJob');
const moment = require('moment');
const CONST = require('../constants');
const errors = require('../errors');
const ScheduleManager = require('./ScheduleManager');
const Promise = require('bluebird');

class OperationStatusPollerJob extends BaseJob {
  constructor() {
    super();
  }

  static run(job, done) {
    job.__started_At = new Date();
    const options = job.attrs.data;

    logger.info(`-> Starting OperationStatusPollerJob -  name: ${job.attrs.name} 
          - operation: ${options.operation} - with options: ${JSON.stringify(options)} `);
    if (!_.get(options, 'deployment_name') || !_.get(options, 'type') ||
      !_.get(options, 'operation') || !_.get(options.operation_response, 'backup_guid')) {
      const msg = `Operation status poller cannot be initiated as the required mandatory params 
      (deployment_name | type | operation | operation_response.backup_guid) is empty : ${JSON.stringify(options)}`;
      logger.error(msg);
      this.runFailed(new errors.BadRequest(msg), {}, job, done);
      return;
    }

    return this.checkOperationCompletionStatus(options.operation_response, job, done);
  }

  static checkOperationCompletionStatus(operationResp, job, done) {
    function isFinished(state) {
      return _.includes(['succeeded', 'failed', 'aborted'], state);
    }
    const operationStartedAt = moment(new Date(job.attrs.data.operation_job_started_at));
    const deploymentName = job.attrs.data.deployment_name;
    const operationName = job.attrs.data.operation;
    const backupGuid = job.attrs.data.operation_response.backup_guid;
    const boshDirectorName = job.attrs.data.bosh_director;
    try {
      Promise.try(() => {
          if (operationName === 'backup') {
            return this
              .getBrokerClient()
              .getDeploymentBackupStatus(deploymentName, operationResp.token, boshDirectorName);
          } else if (operationName === 'restore') {
            return this
              .getBrokerClient()
              .getDeploymentRestoreStatus(deploymentName, operationResp.token, boshDirectorName);
          } else {
            this.runFailed(new errors.BadRequest(`${operationName} NOT supported for job ${CONST.JOB.OPERATION_STATUS_POLLER}`), {}, job, done);
          }
        })
        .then(operationStatusResponse => {
          if (isFinished(operationStatusResponse.state)) {
            ScheduleManager.cancelSchedule(`${deploymentName}_${operationName}_${backupGuid}`, CONST.JOB.OPERATION_STATUS_POLLER)
              .then(() => {
                logger.info(`Deployment ${deploymentName} ${operationName} for backup guid ${backupGuid} completed -`, operationStatusResponse);
                if (operationStatusResponse.state === 'succeeded') {
                  this.runSucceeded(operationStatusResponse, job, done);
                } else {
                  const msg = `Deployment ${deploymentName} ${operationName} for backup guid ${backupGuid} ${operationStatusResponse.state}`;
                  logger.error(msg);
                  const err = {
                    statusCode: `ERR_DEPLOYMENT_${operationName.toUpperCase()}_${operationStatusResponse.state.toUpperCase()}`,
                    statusMessage: msg
                  };
                  this.runFailed(err, operationStatusResponse, job, done);
                }
              });
          } else {
            logger.info(`Deployment ${deploymentName} ${operationName} for backup guid ${backupGuid} still in-progress - `, operationStatusResponse);
            const currTime = moment();
            // 'backup_restore_status_poller_timeout' config data might need to put in job data: operation specific
            // operation can be other than backup/restore : thought just for future reference
            if (currTime.diff(operationStartedAt) > config.backup.backup_restore_status_poller_timeout) {
              ScheduleManager.cancelSchedule(`${deploymentName}_${operationName}_${backupGuid}`, CONST.JOB.OPERATION_STATUS_POLLER)
                .then(() => {
                  const msg = `Deployment ${deploymentName} ${operationName} with backup guid ${backupGuid} exceeding timeout time 
                      ${config.backup.backup_restore_status_poller_timeout / 1000 / 60} (mins). Stopping status check`;
                  logger.error(msg);
                  const err = {
                    statusCode: 'ERR_BACKUP_TIME_OUT',
                    statusMessage: msg
                  };
                  return this.runFailed(err, operationStatusResponse, job, done);
                });
            } else {
              this.runSucceeded(operationStatusResponse, job, done);
            }
          }
        });
    } catch (err) {
      logger.error(`Error occurred while checking for deployment ${deploymentName} ${operationName} status. More info:`, err);
      this.runFailed(err, {}, job, done);
    }
  }
}

module.exports = OperationStatusPollerJob;