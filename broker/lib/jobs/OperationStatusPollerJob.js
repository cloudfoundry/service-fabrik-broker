'use strict';

const _ = require('lodash');
const logger = require('../logger');
const config = require('../config');
const BaseJob = require('./BaseJob');
const moment = require('moment');
const CONST = require('../constants');
const errors = require('../errors');
const ScheduleManager = require('./ScheduleManager');
const backupStore = require('../iaas').backupStoreForOob;
const utils = require('../utils');
const Promise = require('bluebird');

class OperationStatusPollerJob extends BaseJob {
  constructor() {
    super();
  }

  static run(job, done) {
    job.__started_At = new Date();
    const options = job.attrs.data;
    logger.info(`-> Starting OperationStatusPollerJob -  name: ${job.attrs.data[CONST.JOB_NAME_ATTRIB]}
          - operation: ${options.operation} - with options: ${JSON.stringify(options)} `);
    if (!_.get(options, 'deployment_name') || !_.get(options, 'type') ||
      !_.get(options, 'operation') || !_.get(options.operation_response, 'backup_guid')) {
      const msg = `Operation status poller cannot be initiated as the required mandatory params 
      (deployment_name | type | operation | operation_response.backup_guid) is empty : ${JSON.stringify(options)}`;
      logger.error(msg);
      return this.runFailed(new errors.BadRequest(msg), {}, job, done);
    } else if (_.get(options, 'operation') !== 'backup' && _.get(options, 'operation') !== 'restore') {
      const msg = `Operation pollinng not supported for operation - ${options.operation}`;
      logger.error(msg);
      const err = {
        statusCode: `ERR_${options.operation.toUpperCase()}_NOT_SUPPORTED`,
        statusMessage: msg
      };
      return this.runFailed(err, {}, job, done);
    } else {
      return this.checkOperationCompletionStatus(options.operation_response, job)
        .then(operationStatusResponse => this.runSucceeded(operationStatusResponse, job, done))
        .catch(err => {
          logger.error(`Error occurred while running operation ${options.operation} status poller for deployment ${_.get(options, 'deployment_name')}.`, err);
          return this.runFailed(err, {}, job, done);
        });
    }
  }

  static checkOperationCompletionStatus(operationResp, job) {

    const operationStartedAt = moment(new Date(job.attrs.data.operation_job_started_at));
    const deploymentName = job.attrs.data.deployment_name;
    const operationName = job.attrs.data.operation;
    const backupGuid = job.attrs.data.operation_response.backup_guid;
    const boshDirectorName = job.attrs.data.bosh_director;

    return Promise.try(() => {
      if (operationName === 'backup') {
        return this
          .getBrokerClient()
          .getDeploymentBackupStatus(deploymentName, operationResp.token, boshDirectorName);
      } else if (operationName === 'restore') {
        return this
          .getBrokerClient()
          .getDeploymentRestoreStatus(deploymentName, operationResp.token, boshDirectorName);
      } else {
        throw new errors.BadRequest(`Operation ${operationName} not supported by status poller.`);
      }
    })
      .then(operationStatusResponse => {
        operationStatusResponse.jobCancelled = false;
        operationStatusResponse.operationTimedOut = false;
        if (utils.isServiceFabrikOperationFinished(operationStatusResponse.state)) {
          return ScheduleManager.cancelSchedule(`${deploymentName}_${operationName}_${backupGuid}`, CONST.JOB.OPERATION_STATUS_POLLER)
            .then(() => {
              logger.info(`Deployment ${deploymentName} ${operationName} for backup guid ${backupGuid} completed -`, operationStatusResponse);
              operationStatusResponse.jobCancelled = true;
              return operationStatusResponse;
            });
        } else {
          logger.info(`Deployment ${deploymentName} ${operationName} for backup guid ${backupGuid} still in-progress - `, operationStatusResponse);
          const currTime = moment();
          // 'backup_restore_status_poller_timeout' config data might need to put in job data: operation specific
          // operation can be other than backup/restore : thought just for future reference
          if (currTime.diff(operationStartedAt) > config.backup.backup_restore_status_poller_timeout) {
            return ScheduleManager.cancelSchedule(`${deploymentName}_${operationName}_${backupGuid}`, CONST.JOB.OPERATION_STATUS_POLLER)
              .then(() => {
                const msg = `Deployment ${deploymentName} ${operationName} with backup guid ${backupGuid} exceeding timeout time 
                      ${config.backup.backup_restore_status_poller_timeout / 1000 / 60} (mins). Stopping status check`;
                logger.error(msg);
                operationStatusResponse.jobCancelled = true;
                operationStatusResponse.operationTimedOut = true;
                return operationStatusResponse;
              });
          } else {
            return operationStatusResponse;
          }
        }
      })
      .catch(errors.NotFound, (err) => {
        return Promise.try(() => {
          if (operationName === 'backup') {
            return backupStore
              .patchBackupFile({
                deployment_name: deploymentName,
                root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME,
                backup_guid: backupGuid
              }, {
                  state: CONST.OPERATION.ABORTED
                });
          } else if (operationName === 'restore') {
            return backupStore
              .patchRestoreFile({
                deployment_name: deploymentName,
                root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
              }, {
                  state: CONST.OPERATION.ABORTED
                });
          }
        })
          .then(() => ScheduleManager.cancelSchedule(`${deploymentName}_${operationName}_${backupGuid}`, CONST.JOB.OPERATION_STATUS_POLLER))
          .then(() => {
            throw err;
          });
      });
  }
}

module.exports = OperationStatusPollerJob;