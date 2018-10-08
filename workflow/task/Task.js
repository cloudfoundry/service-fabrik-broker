'use strict';


const apiServerClient = require('../../data-access-layer/eventmesh').apiServerClient;
const errors = require('../../common/errors');

class Task {

  static run() {
    throw new errors.NotImplementedBySubclass('run');
  }

  static getStatus(resource) {
    return apiServerClient.getLastOperation({
      resourceGroup: resource.resourceGroup,
      resourceType: resource.resourceType,
      resourceId: resource.resourceId
    });
  }

  static updateStatus(task, status) {
    return apiServerClient.updateResource({
      resourceGroup: task.resourceGroup,
      resourceType: task.resourceType,
      resourceId: task.resourceId,
      status: {
        lastOperation: status,
        state: status.state
      }
    });
  }
}

module.exports = Task;