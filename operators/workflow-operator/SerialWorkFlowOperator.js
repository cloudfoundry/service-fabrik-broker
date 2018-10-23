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
const BaseOperator = require('../../operators/BaseOperator');
const TaskFabrik = require('./task/TaskFabrik');
const FAILED = true;

class SerialWorkFlowOperator extends BaseOperator {

  init() {
    const statesToWatchForWorkflowExecution = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE];
    const statesToWatchForTaskRelay = [CONST.APISERVER.TASK_STATE.DONE];
    this.WORKFLOW_DEFINITION = yaml.safeLoad(fs.readFileSync(path.join(__dirname, 'serial-workflow-definition.yml')));
    this.pollers = {};
    logger.debug('Registering CRDs related to Workflow Manager..!');
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW, CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW)
      .then(() => {
        this.registerWatcher(
          CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
          CONST.APISERVER.RESOURCE_TYPES.SERIAL_WORK_FLOW,
          statesToWatchForWorkflowExecution);
        logger.debug('Registered watcher for Workflow Manager.');
        this.registerWatcher(
          CONST.APISERVER.RESOURCE_GROUPS.WORK_FLOW,
          CONST.APISERVER.RESOURCE_TYPES.TASK,
          statesToWatchForTaskRelay,
          (event) => this.relayTask(event),
          CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL);
        logger.debug('Registered watcher for Workflow Tasks!.');
      });
  }

  processRequest(resource) {
    return Promise.try(() => {
      assert.ok(resource.metadata.name, `Argument 'metadata.name' is required to run the task`);
      assert.ok(resource.spec.options, `Argument 'spec.options' is required to run the task`);
      const workFlowOptions = JSON.parse(resource.spec.options);
      if (this.WORKFLOW_DEFINITION[workFlowOptions.workflow_name] === undefined) {
        return this
          .workflowComplete(workFlowOptions, `Invalid workflow ${workFlowOptions.workflow_name}. No workflow definition found!`, FAILED)
          .throw(new errors.BadRequest(`Invalid workflow ${workFlowOptions.workflow_name}. No workflow definition found!`));
      }
      const workflow = this.WORKFLOW_DEFINITION[workFlowOptions.workflow_name];
      const tasks = workflow.tasks;
      assert.equal(tasks.length > 0, true, `workflow ${workFlowOptions.name} does not have right task definitions. Please check`);
      workFlowOptions.workflowId = resource.metadata.name;
      workFlowOptions.task_order = 0;
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
        }))
        .tap((resource) => logger.info('Created task -> ', resource))
        .then(() => this.updateWorkflowStatus(
          workFlowOptions, {
            state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
            description: `${tasks[0].task_description} in progress @ ${new Date()}`
          }))
        .tap((resource) => logger.info('Successfully updated workflow ::', resource.body.status));
    });
  }

  relayTask(event) {
    return Promise.try(() => {
      logger.debug('Received Task Event For Relay --: ', event);
      const resourceDetails = apiServerClient.parseResourceDetailsFromSelfLink(event.metadata.selfLink);
      const previousTaskDetails = JSON.parse(event.spec.options);
      const taskDetails = _.omit(previousTaskDetails, 'resource', 'response');
      const workflow = this.WORKFLOW_DEFINITION[taskDetails.workflow_name];
      const tasks = workflow.tasks;
      const task = TaskFabrik.getTask(taskDetails.task_type);
      taskDetails.task_order = taskDetails.task_order + 1;
      let previousTaskResponse;
      try {
        previousTaskResponse = JSON.parse(event.status.response);
      } catch (err) {
        previousTaskResponse = event.status.response;
      }
      taskDetails.previous_task = {
        type: taskDetails.task_type,
        description: taskDetails.task_description,
        state: event.status.state,
        response: previousTaskResponse
      };
      const relayedStatus = {
        state: previousTaskResponse.state,
        response: previousTaskResponse,
        message: `Last Task complete.`
      };
      if (previousTaskResponse.state !== CONST.OPERATION.SUCCEEDED) {
        logger.info(`Task ${resourceDetails.resourceId} has failed. workflow will be marked as failed.`);
        relayedStatus.message = `Task - ${taskDetails.task_description} failed and workflow is also marked as failed.`;
        return task
          .updateStatus(resourceDetails, relayedStatus)
          .then(() => this.workflowComplete(taskDetails, `${taskDetails.task_description} failed - ${previousTaskResponse.description}`, FAILED));
      }
      logger.info(`Order of next task ${taskDetails.task_order} - # of tasks in workflow ${workflow.tasks.length}`);
      if (workflow.tasks.length === taskDetails.task_order) {
        logger.info('Workflow complete. Updating the status of last task as complete and marking workflow as done.');
        return task
          .updateStatus(resourceDetails, relayedStatus)
          .then(() => this.workflowComplete(taskDetails));
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
            options: _.merge(taskDetails, tasks[taskDetails.task_order]),
            status: {
              state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
              lastOperation: {},
              response: {}
            }
          }))
          .then(() => {
            logger.info('Created next task in the workflow. Updating the state of current task as Relayed.');
            relayedStatus.message = `Task complete and next relayed task is ${relayedTaskId}`;
            return task.updateStatus(resourceDetails, relayedStatus);
          })
          .then(() => this.updateWorkflowStatus(
            taskDetails, {
              state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
              description: `${tasks[taskDetails.task_order-1].task_description} is complete. Initiated ${tasks[taskDetails.task_order].task_description} @ ${new Date()}`
            }))
          .return(CONST.APISERVER.HOLD_PROCESSING_LOCK);
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

  workflowComplete(taskDetails, message, failed) {
    const state = failed ? CONST.OPERATION.FAILED : CONST.OPERATION.SUCCEEDED;
    const status = {
      state: state,
      description: message || `${this.WORKFLOW_DEFINITION[taskDetails.workflow_name].description} ${state} @ ${new Date()}`
    };
    return this.updateWorkflowStatus(taskDetails, status);
  }
}

module.exports = SerialWorkFlowOperator;