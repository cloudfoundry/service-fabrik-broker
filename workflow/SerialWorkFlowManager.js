'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const assert = require('assert');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const CONST = require('../../common/constants');
const utils = require('../../common/utils');
const apiServerClient = require('../../data-access-layer/eventmesh').apiServerClient;
const BaseManager = require('../../managers/BaseManager');
const TaskFabrik = require('./TaskFabrik');

class SerialWorkFlowManager extends BaseManager {
  init() {
    const statesToWatchForWorkflowExecution = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE];
    const statesToWatchForTaskRelay = [CONST.APISERVER.TASK_STATE.DONE];
    this.WORKFLOW_DEFINITION = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'serial-workflow-definition.yml')));
    this.pollers = {};
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW, CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW)
      .then(() => this.registerWatcher(
        CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
        CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW,
        statesToWatchForWorkflowExecution))
      .then(() => this.registerWatcher(
        CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
        CONST.APISERVER.RESOURCE_TYPES.TASK,
        statesToWatchForTaskRelay,
        (event) => this.relayTask(event),
        CONST.POLLER_WATCHER_REFRESH_INTERVAL));
  }

  processRequest(resource) {
    return Promise.try(() => {
      assert.ok(resource.metadata.name, `Argument 'metadata.name' is required to run the task`);
      assert.ok(resource.spec.options, `Argument 'spec.options' is required to run the task`);
      const workFlowOptions = JSON.parse(resource.spec.options);
      if (this.WORKFLOW_DEFINITION[workFlowOptions.name] === undefined) {
        throw new errors.BadRequest(`Invalid workflow ${workFlowOptions.name}. No workflow definition found!`);
      }
      const workflow = this.WORKFLOW_DEFINITION[workFlowOptions.workflow_name];
      const tasks = _.sortBy(workflow.tasks, 'task_data.order');
      assert.equals(tasks.length > 0, true, `workflow ${workFlowOptions.name} does not have right task definitions. Please check`);
      const labels = {
        workflowId: workFlowOptions.workflowId
      };
      return utils
        .uuidV4()
        .then(taskId => apiServerClient.createResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
          resourceId: taskId,
          labels: labels,
          options: _.merge(workFlowOptions, tasks[0]),
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            lastOperation: {},
            response: {}
          }
        }));
    });
  }

  relayTask(event) {
    return Promise.try(() => {
      logger.debug('Received Task Event: ', event);
      const resourceDetails = apiServerClient.parseResourceDetailsFromSelfLink(event.object.metadata.selfLink);
      const taskDetails = JSON.parse(event.object.spec.options);
      const workflow = this.WORKFLOW_DEFINITION[taskDetails.workflow_name];
      const tasks = _.sortBy(workflow.tasks, 'task_data.order');
      if (workflow.tasks.length === taskDetails.task_data.order) {
        return this.workflowComplete(taskDetails);
      } else {
        const labels = {
          workflowId: taskDetails.workflowId
        };
        let relayedTaskId;
        return utils
          .uuidV4()
          .tap(taskId => relayedTaskId = taskId)
          .then(taskId => apiServerClient.createResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
            resourceId: taskId,
            labels: labels,
            options: _.merge(taskDetails, tasks[taskDetails.task_data.order]),
            status: {
              state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
              lastOperation: {},
              response: {}
            }
          }))
          .then(() => {
            const relayedStatus = {
              state: CONST.APISERVER.TASK_STATE.RELAYED,
              message: `Task complete and next relayed task is ${relayedTaskId}`
            };
            const task = TaskFabrik.getTask(taskDetails.task_type);
            return task.updateStatus(resourceDetails, relayedStatus);
          })
          .then(() => this.updateWorkflowStatus(
            taskDetails, {
              state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
              description: `${tasks[taskDetails.task_data.order-1].description} completed @ ${new Date()}`
            }));
      }
    });
  }
  updateWorkflowStatus(taskDetails, status) {
    return apiServerClient.updateResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW,
      resourceId: taskDetails.workflowId,
      status: {
        lastOperation: status,
        state: status.state
      }
    });
  }

  workflowComplete(taskDetails) {
    const status = {
      state: CONST.OPERATION.SUCCEEDED,
      description: `Workflow with all tasks completed @ ${new Date()}`
    };
    return this.updateWorkflowStatus(taskDetails, status);
  }
}

module.exports = new SerialWorkFlowManager();