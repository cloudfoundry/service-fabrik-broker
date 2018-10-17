'use strict';

const Promise = require('bluebird');
const logger = require('../../../common/logger');
const CONST = require('../../../common/constants');
const Task = require('./Task');


class BlueprintTask extends Task {

  static run(taskId, taskDetails) {
    logger.info(`Running Blueprint Task with Data - ${JSON.stringify((taskDetails))}`);
    return Promise.try(() => {
      taskDetails.resource = {
        resourceGroup: 'RG Of the resource which Task is executing',
        resourceType: 'Type of the resource which Task is executing',
        resourceId: 'Resource ID of the resource which would be getting created by the task in this run method'
      };
      taskDetails.response = {
        description: 'Task Run initiated successfully... Wait for poll to complete status.'
      };
      return taskDetails;
    });
  }

  static getStatus(taskId, taskDetails) {
    return Promise.try(() => {
      logger.info(`Returning Blueprint Task Status for task - ${taskId} : ${JSON.stringify(taskDetails.task_data)}`);
      //No need to override the method if the status is the default resource state that is to be monitored.
      return {
        state: CONST.OPERATION.SUCCEEDED,
        description: 'Blueprint Task succeeded!'
      };
    });
  }
}

module.exports = BlueprintTask;