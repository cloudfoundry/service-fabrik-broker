'use strict';

const assert = require('assert');
const CONST = require('../common/constants');
let ServiceInstanceUpdate;

class TaskFabrik {
  static getTask(taskType) {
    switch (taskType) {
    case CONST.TASK.SERVICE_INSTANCE_UPDATE:
      if (ServiceInstanceUpdate === undefined) {
        ServiceInstanceUpdate = require('./ScheduleBackupJob');
      }
      return ServiceInstanceUpdate;
    default:
      assert.fail(taskType, [CONST.TASK.SERVICE_INSTANCE_UPDATE], `Invalid task type. ${taskType} does not exist`, 'in');
    }
  }
}

module.exports = TaskFabrik;