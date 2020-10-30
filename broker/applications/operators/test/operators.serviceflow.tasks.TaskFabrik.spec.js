'use strict';

const TaskFabrik = require('../src/serviceflow-operator/task/TaskFabrik');
const { CONST } = require('@sf/common-utils');
const AssertionError = require('assert').AssertionError;

describe('operators', function () {
  describe('ServiceFlow', function () {
    describe('tasks', function () {
      describe('TaskFabrik', function () {

        it('returns required task implementation/throws error for unknown task types', () => {
          const ServiceInstanceUpdate = require('../src/serviceflow-operator/task/ServiceInstanceUpdateTask');
          const ServiceInstanceBackup = require('../src/serviceflow-operator/task/ServiceInstanceBackupTask');
          const BlueprintTask = require('../src/serviceflow-operator/task/BlueprintTask');
          expect(TaskFabrik.getTask(CONST.APISERVER.TASK_TYPE.SERVICE_INSTANCE_UPDATE)).to.eql(ServiceInstanceUpdate);
          expect(TaskFabrik.getTask(CONST.APISERVER.TASK_TYPE.BLUEPRINT)).to.eql(BlueprintTask);
          expect(TaskFabrik.getTask(CONST.APISERVER.TASK_TYPE.SERVICE_INSTANCE_BACKUP)).to.eql(ServiceInstanceBackup);
          expect(TaskFabrik.getTask.bind(TaskFabrik, 'Invalid')).to.throw(AssertionError);
        });
        it('gets Task status successfully', () => {});
        it('updates Task state successfully', () => {});
      });
    });
  });
});
