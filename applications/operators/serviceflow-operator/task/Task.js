'use strict';

const apiServerClient = require('../../../data-access-layer/eventmesh').apiServerClient;
const errors = require('../../../common/errors');
const logger = require('../../../common/logger');

class Task {

  static run() {
    throw new errors.NotImplementedBySubclass('run');
  }

  static getStatus(taskId, taskDetails) {
    logger.debug(`Fetching resource state for ${JSON.stringify(taskDetails)}`);
    return apiServerClient.getResourceStatus({
      resourceGroup: taskDetails.resource.resourceGroup,
      resourceType: taskDetails.resource.resourceType,
      resourceId: taskDetails.resource.resourceId
    });
  }

  static updateStatus(task, status) {
    return apiServerClient.updateResource({
      resourceGroup: task.resourceGroup,
      resourceType: task.resourceType,
      resourceId: task.resourceId,
      status: status
    })
      .tap(() => logger.info(`successfully updated state of task - ${task.resourceId} to ${JSON.stringify(status)}`));
  }
}

module.exports = Task;
