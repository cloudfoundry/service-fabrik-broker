'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const catalog = require('../models/catalog');
const pubsub = require('pubsub-js');
const logger = require('../logger');
const ServiceFabrikOperation = require('./ServiceFabrikOperation');
const bosh = require('../bosh');
const utils = require('../utils');
const config = require('../config');
const CONST = require('../constants');
const EventLogInterceptor = require('../EventLogInterceptor');
const DirectorManager = require('./DirectorManager');
const serviceFabrikClient = require('../cf').serviceFabrikClient;

class FabrikStatusPoller {

  static start(instanceInfo, operation, user) {
    return Promise
      .try(() => {
        assert.ok(instanceInfo.instance_guid, `${operation} poll operation must have the property 'instance_guid'`);
        assert.ok(instanceInfo.agent_ip, `${operation} poll operation must have the property 'agent_ip'`);
        assert.ok(instanceInfo.deployment, `${operation} poll operation must have the property 'deployment'`);
        assert.ok(instanceInfo.space_guid, `${operation} poll operation must have the property 'space_guid'`);
        assert.ok(instanceInfo.backup_guid, `${operation} poll operation must have the property 'backup_guid'`);
        assert.ok(instanceInfo.service_id, `${operation} poll operation must have the property 'service_id'`);
        assert.ok(instanceInfo.plan_id, `${operation} poll operation must have the property 'plan_id'`);
        assert.ok(instanceInfo.started_at, `${operation} poll operation must have the property 'started_at'`);
        instanceInfo.user = user;
        let abortInitiated = false;
        let abortStartTime;
        const checkStatus = () => {
          logger.info(`Checking ${operation} status for deployment :${instanceInfo.deployment}`);
          const plan = catalog.getPlan(instanceInfo.plan_id);
          let operationResponse;
          DirectorManager
            .load(plan)
            .then(directorManager => directorManager.getServiceFabrikOperationState(operation, instanceInfo))
            .tap(status => operationResponse = status)
            .catch(error => {
              logger.error(`Error occurred while checking ${operation} status of :${instanceInfo.deployment}`, error);
            })
            .finally(() => {
              let operationTimedOut = false;
              logger.info(`Status of ${operation} operation on : ${instanceInfo.deployment} for guid: ${instanceInfo.backup_guid} - `, operationResponse);
              let isOperationFinished = operationResponse && utils.isServiceFabrikOperationFinished(operationResponse.state);
              if (!isOperationFinished) {
                const currentTime = new Date();
                const duration = (currentTime - new Date(instanceInfo.started_at)) / 1000;
                const lock_deployment_max_duration = bosh.director.getDirectorConfig(instanceInfo.deployment).lock_deployment_max_duration;
                logger.info(`Lock duration : ${duration} / ${lock_deployment_max_duration} (secs) - for ${operation} on : ${instanceInfo.deployment} for guid : ${instanceInfo.backup_guid}`);
                if (duration > lock_deployment_max_duration) {
                  operationTimedOut = true;
                }
                if (operationTimedOut) {
                  logger.info(`${operation} operation on deployment - ${instanceInfo.deployment} timedout`);
                  if (operation === CONST.OPERATION_TYPE.BACKUP) {
                    if (!abortInitiated) {
                      logger.info(`Aborting Backup due to time out on : ${instanceInfo.deployment} for guid: ${instanceInfo.backup_guid}`);
                      abortInitiated = true;
                      abortStartTime = new Date();
                      return serviceFabrikClient.abortLastBackup(_.pick(instanceInfo, ['instance_guid', 'space_guid']));
                    }
                    const abortDuration = (currentTime - abortStartTime);
                    if (abortDuration < config.backup.abort_time_out) {
                      logger.info(`backup abort is still in progress on : ${instanceInfo.deployment} for guid : ${instanceInfo.backup_guid}`);
                      return;
                    } else {
                      operationResponse = _.clone(operationResponse);
                      operationResponse.state = CONST.OPERATION.ABORTED;
                    }
                    logger.info('Abort Backup timed out on : ${instanceInfo.deployment} for guid : ${instanceInfo.backup_guid}. Flagging backup operation as complete');
                  }
                  isOperationFinished = true;
                }
              }
              if (isOperationFinished) {
                logger.info('Polling complete.');
                const unlockOperation = new ServiceFabrikOperation('unlock', {
                  instance_id: instanceInfo.instance_guid,
                  isOperationSync: true
                });
                const eventLogger = EventLogInterceptor.getInstance(config.external.event_type, 'external');
                const check_res_body = true;
                const resp = {
                  statusCode: 200,
                  body: operationResponse
                };
                if (CONST.URL[operation]) {
                  eventLogger.publishAndAuditLogEvent(CONST.URL[operation], CONST.HTTP_METHOD.POST, instanceInfo, resp, check_res_body);
                }
                clearInterval(timer);
                _.find(this.pollers, (poller, index) => {
                  if (poller === timer) {
                    this.pollers.splice(index, 1);
                    return -1;
                  }
                });
                return utils
                  .retry(() => unlockOperation.invoke(), {
                    maxAttempts: 3,
                    minDelay: 60000
                  })
                  .then(() => logger.info(`Unlocked instance : ${instanceInfo.instance_guid} - deployment : ${instanceInfo.deployment} successfully`))
                  .catch(err => logger.error(`Error occurred while unlocking deployment: ${instanceInfo.deployment} for ${operation} with guid : ${instanceInfo.backup_guid}`, err));
              }
            });
        };
        logger.info(`Polling ${operation} status for deployment :${instanceInfo.deployment} - set every ${config.backup.status_check_every} (ms)`);
        const timer = setInterval(checkStatus,
          config.backup.status_check_every);
        this.pollers.push(timer);
      });
  }

  static startIfNotLocked(lockInfo, operation) {
    if (lockInfo) {
      logger.info(`Poller found valid lock `, lockInfo);
      return this.start(lockInfo.instanceInfo, operation);
    }
  }

  static restart(operation) {
    logger.info(`FabrikStatusPoller restart for ${operation}`);
    return bosh.director
      .getDeploymentNames(false)
      .then(deploymentNames => _.map(deploymentNames, deploymentName => {
        if (utils.deploymentNamesRegExp().test(deploymentName)) {
          return bosh
            .director
            .getLockProperty(deploymentName)
            .then(lockInfo => this.startIfNotLocked(lockInfo, operation))
            .catch(err => logger.error(`Error occurred while setting poller `, err));
        }
      }));
  }

  static clearAllPollers() {
    for (let idx = 0; idx < this.pollers.length; idx++) {
      clearInterval(this.pollers[idx]);
    }
    this.pollers.splice(0, this.pollers.length);
  }
}

FabrikStatusPoller.pollers = [];
pubsub.subscribe(CONST.TOPIC.APP_STARTUP, (eventName, eventInfo) => {
  logger.debug('-> Recieved event ->', eventName);
  if (eventInfo.type === 'external') {
    FabrikStatusPoller.restart('backup');
  }
});
module.exports = FabrikStatusPoller;