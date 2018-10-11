'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const assert = require('assert');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const utils = require('../../common/utils');
const apiServerClient = require('../../data-access-layer/eventmesh').apiServerClient;
const BaseManager = require('../../managers/BaseManager');
const TaskFabrik = require('./TaskFabrik');

class TaskManager extends BaseManager {
  init() {
    const statesToWatchForTaskRun = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE];
    const statesToWatchForTaskStatus = [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS];
    this.pollers = {};
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW, CONST.APISERVER.RESOURCE_TYPES.TASK)
      .then(() => {
        this.registerWatcher(
          CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
          CONST.APISERVER.RESOURCE_TYPES.TASK,
          statesToWatchForTaskRun);
        this.registerWatcher(
          CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
          CONST.APISERVER.RESOURCE_TYPES.TASK,
          statesToWatchForTaskStatus,
          (event) => this.startTaskStatusPoller(event),
          CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL);
        logger.info('registered both watchers for tasks!');
        // 
      });
  }

  processRequest(resource) {
    return Promise.try(() => {
      assert.ok(resource.metadata.name, `Argument 'metadata.name' is required to run the task`);
      assert.ok(resource.spec.options, `Argument 'spec.options' is required to run the task`);
      const taskDetails = JSON.parse(resource.spec.options);
      const task = TaskFabrik.getTask(taskDetails.task_type);
      return task
        .run(resource.metadata.name, _.cloneDeep(taskDetails))
        .tap(() => logger.info(`${taskDetails.task_type} for ${resource.metadata.name} run completed.`))
        .then(taskResponse => {
          taskDetails.resource = taskResponse.resource;
          taskDetails.response = taskResponse.response;
          return apiServerClient.updateResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
            resourceId: resource.metadata.name,
            options: taskDetails,
            status: {
              response: taskDetails.response,
              state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
            }
          });
        })
        .tap(() => logger.info(`Status of task ${taskDetails.task_type} for ${resource.metadata.name} is now set to in-progress.`));
    });
  }

  startTaskStatusPoller(event) {
    logger.debug('Received Task Event: ', event);
    if (!this.pollers[event.metadata.name]) {
      logger.debug(`Starting task status poller for : ${event.metadata.name} with interval of ${CONST.APISERVER.WATCHER_REFRESH_INTERVAL}`);
      const taskDetails = JSON.parse(event.spec.options);
      const task = TaskFabrik.getTask(taskDetails.task_type);
      const intervalId = setInterval(() => this.pollTaskStatus(event, intervalId, task, taskDetails), CONST.APISERVER.WATCHER_REFRESH_INTERVAL);
      this.pollers[event.metadata.name] = task;
      return Promise.resolve('HOLD_PROCESSING_LOCK');
    } else {
      logger.debug(`Poller already set for : ${event.metadata.name}`);
    }
    return Promise.resolve('');
  }

  pollTaskStatus(object, intervalId, task, taskDetails) {
    logger.info(`Polling task status for ${object.metadata.name}`);
    const resourceDetails = apiServerClient.parseResourceDetailsFromSelfLink(object.metadata.selfLink);
    return task
      .getStatus(object.metadata.name, taskDetails)
      .then(operationStatus => {
        const state = _.get(operationStatus, 'state');
        if (utils.isServiceFabrikOperationFinished(state)) {
          logger.info(`TASK COMPLETE - on resource - ${taskDetails.task_type} - ${object.metadata.name} - ${JSON.stringify(resourceDetails)}  - ${JSON.stringify(taskDetails.resource)}`);
          const status = {
            response: operationStatus,
            state: CONST.APISERVER.TASK_STATE.DONE
          };
          return task
            .updateStatus(resourceDetails, status)
            .then(() => this.clearPoller(object, intervalId))
            .then(() => this._releaseProcessingLock(object))
            .tap(() => logger.info('Released processing lock!!!'))
            .return(true);
        } else {
          this.continueToHoldLock(object);
        }
        return false;
      });
  }

  clearPoller(object, intervalId) {
    return Promise.try(() => {
      logger.debug(`Clearing poller interval for task ${object.metadata.name}`);
      if (object.metadata.name) {
        clearInterval(intervalId);
      }
      this._postProcessRequest(object);
      _.unset(this.pollers, object.metadata.name);
    });
  }
}

module.exports = TaskManager;