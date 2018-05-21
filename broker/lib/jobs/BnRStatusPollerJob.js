'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const BasePollerJob = require('./BasePollerJob');
const CONST = require('../constants');
const ScheduleManager = require('./ScheduleManager');
const utils = require('../utils');
const moment = require('moment');
const logger = require('../logger');
const errors = require('../errors');
const config = require('../config');
const bosh = require('../bosh');
const DirectorManager = require('../fabrik/DirectorManager');
const ServiceFabrikOperation = require('../fabrik/ServiceFabrikOperation');
const EventLogInterceptor = require('../../../common/EventLogInterceptor');

class BnRStatusPollerJob extends BasePollerJob {
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
    } else if (_.get(options, 'operation') !== 'backup') {
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
    const operationName = job_data.operation;
    const instanceInfo = job_data.operation_details;
    const operationStartedAt = moment(new Date(instanceInfo.started_at));
    const instance_guid = instanceInfo.instance_guid;
    const backup_guid = instanceInfo.backup_guid;
    //const planId = instanceInfo.plan_id;
    const deployment = instanceInfo.deployment;
    const token = utils.encodeBase64(instanceInfo);
    return Promise.try(() => {
        if (operationName === 'backup') {
          return this
            .getFabrikClient()
            .getInstanceBackupStatus(instanceInfo, token);
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
          //Operation didn't finish in expected time
          logger.info(`Instance ${instance_guid} ${operationName} for backup guid ${backup_guid} still in-progress - `, operationStatusResponse);
          const currTime = moment();
          // 'backup_restore_status_poller_timeout' config data might need to put in job data: operation specific
          // operation can be other than backup/restore : thought just for future reference
          const lock_deployment_max_duration = bosh.director.getDirectorConfig(instanceInfo.deployment).lock_deployment_max_duration;
          if (currTime.diff(operationStartedAt) > lock_deployment_max_duration) {
            if (!instanceInfo.abortStartTime) {
              let abortStartTime = new Date();
              instanceInfo.abortStartTime = abortStartTime;
              return DirectorManager.registerBnRStatusPoller(instanceInfo);
            } else {
              const currentTime = new Date();
              const abortDuration = (currentTime - instanceInfo.abortStartTime);
              if (abortDuration < config.backup.abort_time_out) {
                logger.info(`backup abort is still in progress on : ${deployment} for guid : ${backup_guid}`);
                operationStatusResponse.state = 'aborting'; //define in the constant
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
          return this
            .unlockDeployment(instanceInfo, operationName, operationStatusResponse)
            .then(() => ScheduleManager.cancelSchedule(`${instance_guid}_${operationName}_${backup_guid}`, CONST.JOB.BNR_STATUS_POLLER))
            .then(() => {
              if (operationStatusResponse.operationTimedOut) {
                const msg = `Deployment ${instance_guid} ${operationName} with backup guid ${backup_guid} exceeding timeout time
              ${config.backup.backup_restore_status_poller_timeout / 1000 / 60} (mins). Stopping status check`;
                logger.error(msg);
              } else {
                logger.info(`Instance ${instance_guid} ${operationName} for backup guid ${backup_guid} completed -`, operationStatusResponse);
              }
              operationStatusResponse.jobCancelled = true;
              return operationStatusResponse;
            });
        }
      });
  }
  static unlockDeployment(instanceInfo, operation, operationStatusResponse) {
    const unlockOperation = new ServiceFabrikOperation('unlock', {
      instance_id: instanceInfo.instance_guid,
      isOperationSync: true,
      arguments: {
        description: _.get(operationStatusResponse, 'description') || `${operation} completed`
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