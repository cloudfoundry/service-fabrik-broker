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
const errors = require('../errors');
const config = require('../config');
const CONST = require('../constants');
const EventLogInterceptor = require('../../../common/EventLogInterceptor');
const DirectorManager = require('./DirectorManager');
const serviceFabrikClient = require('../cf').serviceFabrikClient;

class FabrikStatusPoller {

  static start(instanceInfoInput, operation, user) {
    return Promise
      .try(() => {
        let instanceInfo = _.cloneDeep(instanceInfoInput);
        //Since the object maintains the state of poll, cloning it to ensure it cannot be tampered from outside (i.e. caller)
        assert.ok(instanceInfo.instance_guid, `${operation} poll operation must have the property 'instance_guid'`);
        assert.ok(instanceInfo.agent_ip, `${operation} poll operation must have the property 'agent_ip'`);
        assert.ok(instanceInfo.deployment, `${operation} poll operation must have the property 'deployment'`);
        assert.ok(instanceInfo.tenant_id, `${operation} poll operation must have the property 'tenant_id'`);
        assert.ok(instanceInfo.backup_guid, `${operation} poll operation must have the property 'backup_guid'`);
        assert.ok(instanceInfo.service_id, `${operation} poll operation must have the property 'service_id'`);
        assert.ok(instanceInfo.plan_id, `${operation} poll operation must have the property 'plan_id'`);
        assert.ok(instanceInfo.started_at, `${operation} poll operation must have the property 'started_at'`);
        instanceInfo.user = user;
        instanceInfo.operationFinished = false;
        let abortInitiated = false;
        let abortStartTime;
        let checkStatusOperationInProgress = false;
        const checkStatus = () => {
          if (checkStatusOperationInProgress) {
            logger.info(`Previous run of ${operation} status check for deployment :${instanceInfo.deployment} is still in progress. Will skip current poll`);
            return Promise.resolve({});
          }
          return Promise.try(() => {
              checkStatusOperationInProgress = true;
              logger.info(`Checking ${operation} status for deployment :${instanceInfo.deployment}`);
              const plan = catalog.getPlan(instanceInfo.plan_id);
              let operationResponse;
              return Promise.try(() => {
                  if (instanceInfo.operationFinished) {
                    return true;
                  }
                  return DirectorManager
                    .load(plan)
                    .then(directorManager => directorManager.getServiceFabrikOperationState(operation, instanceInfoInput)) //could have used instanceInfo itself, but for UT setups need this to be passed
                    .tap(status => operationResponse = status);
                })
                .catch(error => {
                  logger.error(`Error occurred while checking ${operation} status of :${instanceInfo.deployment} - for guid: ${instanceInfo.backup_guid}`, error);
                })
                .finally(() => {
                  if (!instanceInfo.operationFinished) {
                    let operationTimedOut = false;
                    logger.info(`Status of ${operation} operation on : ${instanceInfo.deployment} for guid: ${instanceInfo.backup_guid} - `, operationResponse);
                    instanceInfo.operationFinished = operationResponse && utils.isServiceFabrikOperationFinished(operationResponse.state);
                    instanceInfo.operationResponse = _.clone(operationResponse);
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
                          return serviceFabrikClient.abortLastBackup(_.pick(instanceInfo, ['instance_guid', 'tenant_id']));
                        }
                        const abortDuration = (currentTime - abortStartTime);
                        if (abortDuration < config.backup.abort_time_out) {
                          logger.info(`backup abort is still in progress on : ${instanceInfo.deployment} for guid : ${instanceInfo.backup_guid}`);
                          return;
                        } else {
                          instanceInfo.operationResponse.state = CONST.OPERATION.ABORTED;
                        }
                        logger.info('Abort Backup timed out on : ${instanceInfo.deployment} for guid : ${instanceInfo.backup_guid}. Flagging backup operation as complete');
                      }
                      instanceInfo.operationFinished = true;
                    }
                  }
                  if (instanceInfo.operationFinished) {
                    logger.info(`Backup complete for guid : ${instanceInfo.backup_guid} -  deployment : ${instanceInfo.deployment} `);
                    const unlockOperation = new ServiceFabrikOperation('unlock', {
                      instance_id: instanceInfo.instance_guid,
                      isOperationSync: true,
                      arguments: {
                        description: _.get(operationResponse, 'description')
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
                          body: instanceInfo.operationResponse
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
                      })
                      .catch(err => logger.error(`Error occurred while unlocking deployment: ${instanceInfo.deployment} for ${operation} with guid : ${instanceInfo.backup_guid}`, err));
                  }
                });
            })
            .finally(() => checkStatusOperationInProgress = false);
        };
        logger.info(`Polling ${operation} status for deployment :${instanceInfo.deployment} - set every ${config.backup.status_check_every} (ms)`);
        const timer = setInterval(checkStatus,
          config.backup.status_check_every);
        this.pollers.push(timer);
      });
  }

  static startIfNotLocked(lockInfo, operation) {
    //checking of lockInfo.instanceInfo done to support
    // ongoing-backup's status polling. After introduction of
    // BnRStatusPoller lockinfo won't have 'instanceInfo'.
    if (lockInfo && lockInfo.instanceInfo) {
      logger.info(`Poller found valid lock `, lockInfo);
      return this.start(lockInfo.instanceInfo, operation);
    }
  }

  static restart(operation) {
    logger.info(`FabrikStatusPoller restart for ${operation}`);
    //Introducing a delay at restart as this happens recursively in case BOSH is down
    return Promise.delay(config.backup.retry_delay_on_error)
      .then(() => {
        if (!FabrikStatusPoller.stopPoller) {
          let numberOfSFDeployment = 0;
          return utils
            .retry(() => bosh.director
              .getDeploymentNamesFromCache(), {
                maxAttempts: 3,
                minDelay: config.backup.retry_delay_on_error
              })
            .then(deploymentNames => _.map(deploymentNames, deploymentName => {
              if (utils.deploymentNamesRegExp().test(deploymentName)) {
                numberOfSFDeployment++;
                return Promise
                  .delay(config.backup.lock_check_delay_on_restart * numberOfSFDeployment)
                  .then(() => utils
                    .retry(() => bosh
                      .director
                      .getLockProperty(deploymentName), {
                        maxAttempts: 3,
                        minDelay: config.backup.retry_delay_on_error
                      })
                    .then(lockInfo => this.startIfNotLocked(lockInfo, operation))
                    .catch(err => logger.error(`Error occurred while setting poller for ${deploymentName}`, err)));
              }
            }))
            .catch(errors.Timeout, (err) => {
              logger.error('Error occurred while fetching deployments ...', err);
              FabrikStatusPoller.restart('backup');
              //If we have BOSH errors and getDeployment fails even after a retry with exponential backoff, retry all over again.
              return null;
              //Returning null as unit tests can atleast proceed with verification else they will wait timeout
            });
        }
      });
  }

  static clearAllPollers() {
    for (let idx = 0; idx < this.pollers.length; idx++) {
      clearInterval(this.pollers[idx]);
    }
    this.pollers.splice(0, this.pollers.length);
  }
}

FabrikStatusPoller.pollers = [];
FabrikStatusPoller.stopPoller = false; //Used mainly from tests. Else, the poller keeps running and other mocks in test suite will suffer
pubsub.subscribe(CONST.TOPIC.APP_STARTUP, (eventName, eventInfo) => {
  logger.debug('-> Received event ->', eventName);
  if (eventInfo.type === 'external') {
    FabrikStatusPoller.restart('backup');
  }
});
module.exports = FabrikStatusPoller;