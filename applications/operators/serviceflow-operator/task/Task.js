'use strict';

const { apiServerClient } = require('@sf/eventmesh');
const {
  errors: {
    NotImplementedBySubclass
  }
} = require('@sf/common-utils');
const logger = require('@sf/logger');

class Task {

  static run() {
    throw new NotImplementedBySubclass('run');
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
