'use strict';

const _ = require('lodash');
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
      .then(() => this.registerWatcher(
        CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
        CONST.APISERVER.RESOURCE_TYPES.TASK,
        statesToWatchForTaskRun))
      .then(() => this.registerWatcher(
        CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
        CONST.APISERVER.RESOURCE_TYPES.TASK,
        statesToWatchForTaskStatus,
        (event) => this.startTaskStatusPoller(event),
        CONST.POLLER_WATCHER_REFRESH_INTERVAL));
  }

  processRequest(resource) {
    return Promise.try(() => {
      assert.ok(resource.metadata.name, `Argument 'metadata.name' is required to run the task`);
      assert.ok(resource.spec.options, `Argument 'spec.options' is required to run the task`);
      const taskDetails = JSON.parse(resource.spec.options);
      const task = TaskFabrik.getTask(taskDetails.task_type);
      return task.run(taskDetails);
    });
  }

  startTaskStatusPoller(event) {
    logger.debug('Received Task Event: ', event);
    if (event.type === CONST.API_SERVER.WATCH_EVENT.MODIFIED &&
      !this.pollers[event.object.metadata.name]) {
      logger.debug('starting task status poller for : ', event.object.metadata.name);
      const taskDetails = JSON.parse(event.object.spec.options);
      const task = TaskFabrik.getTask(taskDetails.task_type);
      const intervalId = setInterval(() => this.pollTaskStatus(event.object, intervalId, task, taskDetails), CONST.WATCHER_REFRESH_INTERVAL);
      this.pollers[event.object.metadata.name] = task;
    }
  }

  pollTaskStatus(object, intervalId, task, taskDetails) {
    const resourceDetails = apiServerClient.parseResourceDetailsFromSelfLink(object.metadata.selfLink);
    return task.getStatus(taskDetails.resource).then((status) => {
      const state = _.get(status, 'state');
      if (utils.isServiceFabrikOperationFinished(state)) {
        logger.info(`Task ${taskDetails.type} - ${object.metadata.name} - ${JSON.stringify(resourceDetails)} - COMPLETE - on resource - ${JSON.stringify(taskDetails.resource)}`);
        status.state = CONST.APISERVER.TASK_STATE.DONE;
        return task.updateStatus(resourceDetails, status)
          .then(() => this.clearPoller(object.metadata.name, intervalId))
          .return(true);
      }
      return false;
    });
  }

  clearPoller(resourceId, intervalId) {
    logger.debug(`Clearing poller interval for task ${resourceId}`);
    if (intervalId) {
      clearInterval(intervalId);
    }
    _.unset(this.pollers, resourceId);
  }
}

module.exports = new TaskManager();