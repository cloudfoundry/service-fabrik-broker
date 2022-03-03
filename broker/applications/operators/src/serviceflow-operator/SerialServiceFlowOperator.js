'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const assert = require('assert');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const logger = require('@sf/logger');
const {
  CONST,
  errors: {
    BadRequest,
    Conflict
  }

} = require('@sf/common-utils');
const { apiServerClient } = require('@sf/eventmesh');
const BaseOperator = require('../BaseOperator');
const TaskFabrik = require('./task/TaskFabrik');
const FAILED = true;

class SerialServiceFlowOperator extends BaseOperator {

  init() {
    const statesToWatchForServiceFlowExecution = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE];
    const statesToWatchForTaskRelay = [CONST.APISERVER.TASK_STATE.DONE];
    this.SERVICE_FLOW_DEFINITION = yaml.load(fs.readFileSync(path.join(__dirname, CONST.SERVICE_FLOW.DEFINITION_FILE_NAME)));
    this.pollers = {};
    logger.info('Registering CRDs related to Service Flow Operator..!');
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW, CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW)
      .then(() => {
        this.registerWatcher(
          CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
          CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW,
          statesToWatchForServiceFlowExecution);
        logger.info('Registered watcher for Service Flow Operator..');
        this.registerWatcher(
          CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
          CONST.APISERVER.RESOURCE_TYPES.TASK,
          statesToWatchForTaskRelay,
          event => this.relayTask(event),
          CONST.APISERVER.POLLER_WATCHER_REFRESH_INTERVAL);
        logger.info('Registered watcher for Service Flow Tasks!.');
      });
  }

  processRequest(resource) {
    return Promise.try(() => {
      assert.ok(resource.metadata.name, 'Argument \'metadata.name\' is required to run the task');
      assert.ok(resource.spec.options, 'Argument \'spec.options\' is required to run the task');
      const serviceFlowOptions = JSON.parse(resource.spec.options);
      serviceFlowOptions.serviceflow_id = resource.metadata.name;
      serviceFlowOptions.task_order = 0;
      if (this.SERVICE_FLOW_DEFINITION[serviceFlowOptions.serviceflow_name] === undefined) {
        return this
          .serviceFlowComplete(serviceFlowOptions, `Invalid service flow ${serviceFlowOptions.serviceflow_name}. No service flow definition found!`, FAILED)
          .throw(new BadRequest(`Invalid service flow ${serviceFlowOptions.serviceflow_name}. No service flow definition found!`));
      }
      const serviceFlow = this.SERVICE_FLOW_DEFINITION[serviceFlowOptions.serviceflow_name];
      const tasks = serviceFlow.tasks;
      assert.equal(tasks.length > 0, true, `service flow ${serviceFlowOptions.name} does not have right task definitions. Please check`);
      const labels = {
        serviceflow_id: serviceFlowOptions.serviceflow_id,
        task_order: `${serviceFlowOptions.task_order}`
      };
      const taskId = `${serviceFlowOptions.serviceflow_id}.${serviceFlowOptions.task_order}`;
      return apiServerClient.createResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
        resourceId: taskId,
        labels: labels,
        options: _.merge(serviceFlowOptions, tasks[0]),
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
          response: {}
        }
      })
        .tap(resource => logger.info('Created task -> ', resource))
        .then(() => this.updateServiceFlowStatus(
          serviceFlowOptions, {
            state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
            description: `${tasks[0].task_description} in progress @ ${new Date()}`
          }))
        .tap(resource => logger.info('Successfully updated service flow ::', resource.body.status));
    });
  }

  relayTask(event) {
    return Promise.try(() => {
      logger.debug('Received Task Event For Relay --: ', event);
      const resourceDetails = apiServerClient.parseResourceDetailsFromSelfLink(event.metadata.selfLink);
      const previousTaskDetails = JSON.parse(event.spec.options);
      const taskDetails = _.omit(previousTaskDetails, 'resource', 'response');
      const serviceFlow = this.SERVICE_FLOW_DEFINITION[taskDetails.serviceflow_name];
      const tasks = serviceFlow.tasks;
      const task = TaskFabrik.getTask(taskDetails.task_type);
      taskDetails.task_order = taskDetails.task_order + 1;
      let previousTaskResponse;
      try {
        previousTaskResponse = JSON.parse(event.status.response);
      } catch (err) {
        previousTaskResponse = event.status.response;
      }
      previousTaskResponse.description = previousTaskResponse.description || '';
      taskDetails.previous_task = {
        type: taskDetails.task_type,
        description: taskDetails.task_description,
        state: event.status.state,
        response: previousTaskResponse
      };
      const relayedStatus = {
        state: previousTaskResponse.state,
        response: previousTaskResponse,
        description: 'Last Task complete.'
      };
      if (previousTaskResponse.state !== CONST.OPERATION.SUCCEEDED) {
        logger.info(`Task ${resourceDetails.resourceId} has failed. service flow will be marked as failed.`);
        relayedStatus.description = `Task - ${taskDetails.task_description} failed and service flow is also marked as failed.`;
        return task
          .updateStatus(resourceDetails, relayedStatus)
          .then(() => this.serviceFlowComplete(taskDetails, `${taskDetails.task_description} failed. ${previousTaskResponse.description}`, FAILED));
      }
      logger.info(`Order of next task ${taskDetails.task_order} - # of tasks in service flow ${serviceFlow.tasks.length}`);
      if (serviceFlow.tasks.length === taskDetails.task_order) {
        // TODO: It might also be a good idea to fetch the actual tasks from etcd and check that number than this order
        // Just in case due to some bug or some other reason task order is not getting incremented. For now though not required.
        logger.info('Service Flow complete. Updating the status of last task as complete and marking service flow as done.');
        return task
          .updateStatus(resourceDetails, relayedStatus)
          .then(() => this.serviceFlowComplete(taskDetails));
      } else {
        const labels = {
          serviceflow_id: taskDetails.serviceflow_id,
          task_order: `${taskDetails.task_order}`
        };
        const relayedTaskId = `${taskDetails.serviceflow_id}.${taskDetails.task_order}`;
        // Due to some race conditions (stream refresh/broker restart) same task could be tried to be created again. 
        // Hence task Id is made as a combination of workflow id and task order, which will ensure an
        // exception is thrown when we try to create a dupe task in workflow, which is ignored. 
        // This is done as failsafe mechanism to ensure only one task of a type executes in workflow.
        return apiServerClient.createResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK,
          resourceId: relayedTaskId,
          labels: labels,
          options: _.merge(taskDetails, tasks[taskDetails.task_order]),
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.IN_QUEUE,
            response: {}
          }
        })
          .then(() => {
            logger.info('Created next task in the service flow. Updating the state of current task as Relayed.');
            relayedStatus.description = `Task complete and next relayed task is ${relayedTaskId}`;
            return task.updateStatus(resourceDetails, relayedStatus);
          })
          .then(() => this.updateServiceFlowStatus(
            taskDetails, {
              state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS,
              description: `${tasks[taskDetails.task_order - 1].task_description} is complete. Initiated ${tasks[taskDetails.task_order].task_description} @ ${new Date()}`
            }))
          .catch(Conflict, err => {
            logger.warn(`Trying to recreate same task :${serviceFlow.tasks[taskDetails.task_order].task_type} order:${taskDetails.task_order}. Check for loops in workflow.`, err);
          })
          .return(CONST.APISERVER.HOLD_PROCESSING_LOCK);
      }
    });
  }

  updateServiceFlowStatus(taskDetails, status) {
    return apiServerClient.updateResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW,
      resourceType: CONST.APISERVER.RESOURCE_TYPES.SERIAL_SERVICE_FLOW,
      resourceId: taskDetails.serviceflow_id,
      status: status
    });
  }

  serviceFlowComplete(taskDetails, message, failed) {
    const state = failed ? CONST.OPERATION.FAILED : CONST.OPERATION.SUCCEEDED;
    const status = {
      state: state,
      description: message || `${this.SERVICE_FLOW_DEFINITION[taskDetails.serviceflow_name].description} ${state} @ ${new Date()}`
    };
    return this.updateServiceFlowStatus(taskDetails, status);
  }
}

module.exports = SerialServiceFlowOperator;
