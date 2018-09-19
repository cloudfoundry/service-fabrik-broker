'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const CONST = require('../../common/constants');
const errors = require('../../common/errors');
const logger = require('../../common/logger');
const config = require('../../common/config');
const utils = require('../../common/utils');
const DirectorService = require('./DirectorService');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const AssertionError = assert.AssertionError;
const Conflict = errors.Conflict;

class BackupStatusPoller {
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

  static checkOperationCompletionStatus(opts) {
    logger.info('Checking Operation Completion Status for :', opts);
    const operationName = opts.operation;
    const instance_guid = opts.instance_guid;
    const backup_guid = opts.backup_guid;
    const plan = catalog.getPlan(opts.plan_id);
    return Promise
      .try(() => {
        if (operationName === CONST.OPERATION_TYPE.BACKUP) {
          return BackupService.createService(plan)
            .then(backupService => backupService.getOperationState(CONST.OPERATION_TYPE.BACKUP, opts));
        }
      })
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
        this.doPostFinishOperation(operationStatusResponse, operationName, instanceInfo)
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
        logger.error(`Caught error while checking for operation completion status:`, err);
        throw err;
      });
  }
  static doPostFinishOperation(operationStatusResponse, operationName, instanceInfo) {
    return Promise
      .try(() => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        resourceId: instanceInfo.backup_guid,
        status: {
          'state': operationStatusResponse.state
        }
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

  static start() {
    function poller(object) {
      const resourceDetails = eventmesh.apiServerClient.parseResourceDetailsFromSelfLink(object.metadata.selfLink);
      // If no lockedByPoller annotation then set annotation  with time
      // Else check timestamp if more than specific time than start polling and change lockedByPoller Ip
      return eventmesh.apiServerClient.getResource({
          resourceGroup: resourceDetails.resourceGroup,
          resourceType: resourceDetails.resourceType,
          resourceId: object.metadata.name,
        })
        .then(resourceBody => {
          const options = resourceBody.spec.options;
          const response = resourceBody.status.response;
          const pollerAnnotation = resourceBody.metadata.annotations.lockedByTaskPoller;
          logger.debug(`pollerAnnotation is ${pollerAnnotation} current time is: ${new Date()}`);
          return Promise.try(() => {
            // If task is not picked by poller which has the lock on task for CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL + DIRECTOR_RESOURCE_POLLER_RELAXATION_TIME then try to acquire lock
            if (pollerAnnotation && (JSON.parse(pollerAnnotation).ip !== config.broker_ip) && (new Date() - new Date(JSON.parse(pollerAnnotation).lockTime) < (CONST.DIRECTOR_RESOURCE_POLLER_INTERVAL + CONST.DIRECTOR_RESOURCE_POLLER_RELAXATION_TIME))) { // cahnge this to 5000
              logger.debug(`Process with ip ${JSON.parse(pollerAnnotation).ip} is already polling for task`);
            } else {
              const patchBody = _.cloneDeep(resourceBody);
              const metadata = patchBody.metadata;
              const currentAnnotations = metadata.annotations;
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
                .tap((updatedResource) => logger.debug(`Successfully acquired bosh task poller lock for request with options: ${JSON.stringify(options)}\n` +
                  `Updated resource with poller annotations is: `, updatedResource))
                .then(() => {
                  if (!utils.isServiceFabrikOperationFinished(resourceBody.status.state)) {
                    return BackupStatusPoller.checkOperationCompletionStatus(response);
                  }
                })
                .catch(Conflict, () => {
                  logger.debug(`Not able to acquire backup task poller processing lock for backup with guid ${object.metadata.name}, Request is probably picked by other worker`);
                });
            }
          });
        });
    }

    function startPoller(event) {
      logger.debug('Received Backup Event: ', event);
      return Promise.try(() => {
        if ((event.type === CONST.API_SERVER.WATCH_EVENT.ADDED || event.type === CONST.API_SERVER.WATCH_EVENT.MODIFIED) && !BackupStatusPoller.pollers[event.object.metadata.name]) {
          BackupStatusPoller.pollers[event.object.metadata.name] = true;
          return poller(event.object)
            .finally(() => BackupStatusPoller.pollers[event.object.metadata.name] = false);
        }
      });
    }
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS})`;
    return eventmesh.apiServerClient.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, startPoller, queryString)
      .then(stream => {
        logger.debug(`Successfully set watcher on director resources for task polling with query string:`, queryString);
        return Promise
          .delay(config.backup.backup_restore_status_check_every)
          .then(() => {
            logger.debug(`Refreshing stream after ${config.backup.backup_restore_status_check_every}`);
            stream.abort();
            return this.start();
          });
      })
      .catch(err => {
        logger.error(`Error occured in registering watch for bosh task poller:`, err);
        return Promise
          .delay(CONST.APISERVER.WATCHER_ERROR_DELAY)
          .then(() => {
            logger.debug(`Refreshing stream after ${CONST.APISERVER.WATCHER_ERROR_DELAY}`);
            return this.start();
          });
      });
  }

  static clearPoller(resourceId, intervalId) {
    logger.debug(`Clearing bosh task poller interval for deployment`, resourceId);
    if (intervalId) {
      clearInterval(intervalId);
    }
    _.unset(BackupStatusPoller.pollers, resourceId);
  }
}

BackupStatusPoller.pollers = [];
module.exports = BackupStatusPoller;