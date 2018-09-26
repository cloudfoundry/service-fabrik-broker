'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const cf = require('../../data-access-layer/cf');
const CONST = require('../../common/constants');
const errors = require('../../common/errors');
const logger = require('../../common/logger');
const config = require('../../common/config');
const utils = require('../../common/utils');
const retry = utils.retry;
const catalog = require('../../common/models').catalog;
const EventLogInterceptor = require('../../common/EventLogInterceptor');
const BackupService = require('./BackupService');
const AssertionError = assert.AssertionError;
const Conflict = errors.Conflict;

class BackupStatusPoller {

  static checkOperationCompletionStatus(opts) {
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
        logger.error(`Caught error while checking for backup operation completion status:`, err);
        throw err;
      });
  }
  static doPostFinishOperation(operationStatusResponse, operationName, opts) {
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

  static _logEvent(opts, operation, operationStatusResponse) {
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

  static start() {
    function poller(object, intervalId) {
      const resourceDetails = eventmesh.apiServerClient.parseResourceDetailsFromSelfLink(object.metadata.selfLink);
      // If no lockedByPoller annotation then set annotation  with time
      // Else check timestamp if more than specific time than start polling and change lockedByPoller Ip
      return eventmesh.apiServerClient.getResource({
          resourceGroup: resourceDetails.resourceGroup,
          resourceType: resourceDetails.resourceType,
          resourceId: object.metadata.name,
        })
        .then(resourceBody => {
          const options = _.get(resourceBody, 'spec.options');
          const response = _.get(resourceBody, 'status.response');
          const pollerAnnotation = _.get(resourceBody, 'metadata.annotations.lockedByTaskPoller');
          logger.debug(`Backup status pollerAnnotation is ${pollerAnnotation} current time is: ${new Date()}`);
          return Promise.try(() => {
            // If task is not picked by poller which has the lock on task for config.backup.backup_restore_status_check_every + BACKUP_RESOURCE_POLLER_RELAXATION_TIME then try to acquire lock
            if (pollerAnnotation && (JSON.parse(pollerAnnotation).ip !== config.broker_ip) && (new Date() - new Date(JSON.parse(pollerAnnotation).lockTime) < (config.backup.backup_restore_status_check_every + CONST.BACKUP_RESOURCE_POLLER_RELAXATION_TIME))) { // cahnge this to 5000
              logger.debug(`Process with ip ${JSON.parse(pollerAnnotation).ip} is already polling for task`);
            } else {
              const patchBody = _.cloneDeep(resourceBody);
              const metadata = _.get(patchBody, 'metadata');
              const currentAnnotations = _.get(metadata, 'annotations');
              const patchAnnotations = currentAnnotations ? currentAnnotations : {};
              patchAnnotations.lockedByTaskPoller = JSON.stringify({
                lockTime: new Date(),
                ip: config.broker_ip
              });
              metadata.annotations = patchAnnotations;
              // Handle conflict also
              return eventmesh.apiServerClient.updateResource({
                  resourceGroup: resourceDetails.resourceGroup,
                  resourceType: resourceDetails.resourceType,
                  resourceId: metadata.name,
                  metadata: metadata
                })
                .tap(updatedResource => logger.debug(`Successfully acquired backup status poller lock for request with options: ${JSON.stringify(options)}\n` +
                  `Updated resource with poller annotations is: `, updatedResource))
                .then(() => {
                  if (!utils.isServiceFabrikOperationFinished(resourceBody.status.state)) {
                    const instanceInfo = _.chain(response)
                      .pick('tenant_id', 'backup_guid', 'instance_guid', 'agent_ip', 'service_id', 'plan_id', 'deployment', 'started_at', 'abortStartTime')
                      .value();
                    return BackupStatusPoller.checkOperationCompletionStatus(instanceInfo)
                      .then(operationStatusResponse => {
                        if (utils.isServiceFabrikOperationFinished(operationStatusResponse.state)) {
                          BackupStatusPoller.clearPoller(metadata.name, intervalId);
                        }
                      });
                  } else {
                    BackupStatusPoller.clearPoller(metadata.name, intervalId);
                  }
                })
                .catch(AssertionError, err => {
                  logger.error('Error occured while polling for backup, marking backup as failed', err);
                  BackupStatusPoller.clearPoller(metadata.name, intervalId);
                  return eventmesh.apiServerClient.updateResource({
                    resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
                    resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
                    resourceId: metadata.name,
                    status: {
                      state: CONST.APISERVER.RESOURCE_STATE.FAILED,
                      error: utils.buildErrorJson(err)
                    }
                  });
                })
                .catch(Conflict, () => {
                  logger.debug(`Not able to acquire backup status poller processing lock for backup with guid ${object.metadata.name}, Request is probably picked by other worker`);
                });
            }
          });
        }).catch(err => {
          logger.error(`Error occured while polling for backup state with guid ${object.metadata.name}`, err);
        });
    }

    function startPoller(event) {
      logger.debug('Received Backup Event: ', event);
      return Promise.try(() => {
        const backupGuid = _.get(event, 'object.metadata.name');
        if ((event.type === CONST.API_SERVER.WATCH_EVENT.ADDED || event.type === CONST.API_SERVER.WATCH_EVENT.MODIFIED) && !BackupStatusPoller.pollers[backupGuid]) {
          logger.debug('starting backup status poller for backup with guid ', backupGuid);
          // Poller time should be little less than watch refresh interval as 
          const intervalId = setInterval(() => poller(event.object, intervalId), config.backup.backup_restore_status_check_every);
          BackupStatusPoller.pollers[backupGuid] = intervalId;
        }
      });
    }
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS},${CONST.APISERVER.RESOURCE_STATE.ABORTING})`;
    return eventmesh.apiServerClient.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, startPoller, queryString)
      .then(stream => {
        logger.debug(`Successfully set watcher on backup resources for backup status polling with query string:`, queryString);
        return Promise
          .delay(CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL)
          .then(() => {
            logger.debug(`Refreshing backup stream after ${CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL}`);
            stream.abort();
            return this.start();
          });
      })
      .catch(err => {
        logger.error('Error occured in registering watch for backup status poller:', err);
        return Promise
          .delay(CONST.APISERVER.WATCHER_ERROR_DELAY)
          .then(() => {
            logger.debug(`Refreshing backup stream on error after ${CONST.APISERVER.WATCHER_ERROR_DELAY}`);
            return this.start();
          });
      });
  }
  static clearPoller(resourceId, intervalId) {
    logger.debug(`Clearing backup status poller interval for backup with guid`, resourceId);
    if (intervalId) {
      clearInterval(intervalId);
    }
    _.unset(BackupStatusPoller.pollers, resourceId);
  }
}

BackupStatusPoller.pollers = [];
module.exports = BackupStatusPoller;