'use strict';

const assert = require('assert');
const CONST = require('../../../common/constants');
let ServiceInstanceUpdate, BlueprintTask;

class TaskFabrik {
  static getTask(taskType) {
    switch (taskType) {
    case CONST.APISERVER.TASK_TYPE.SERVICE_INSTANCE_UPDATE:
      if (ServiceInstanceUpdate === undefined) {
        ServiceInstanceUpdate = require('./ServiceInstanceUpdateTask');
      }
      return ServiceInstanceUpdate;
    case CONST.APISERVER.TASK_TYPE.BLUEPRINT:
      if (BlueprintTask === undefined) {
        BlueprintTask = require('./BlueprintTask');
      }
      return BlueprintTask;
    default:
      assert.fail(taskType, [CONST.TASK.SERVICE_INSTANCE_UPDATE], `Invalid task type. ${taskType} does not exist`, 'in');
    }
  }
}

module.exports = TaskFabrik;