'use strict';

const TaskFabrik = require('../../operators/serviceflow-operator/task/TaskFabrik');
const CONST = require('../../common/constants');
const AssertionError = require('assert').AssertionError;

describe('operators', function () {
  describe('ServiceFlow', function () {
    describe('tasks', function () {
      describe('TaskFabrik', function () {

        it('returns required task implementation/throws error for unknown task types', () => {
          const ServiceInstanceUpdate = require('../../operators/serviceflow-operator/task/ServiceInstanceUpdateTask');
          const BlueprintTask = require('../../operators/serviceflow-operator/task/BlueprintTask');
          expect(TaskFabrik.getTask(CONST.APISERVER.TASK_TYPE.SERVICE_INSTANCE_UPDATE)).to.eql(ServiceInstanceUpdate);
          expect(TaskFabrik.getTask(CONST.APISERVER.TASK_TYPE.BLUEPRINT)).to.eql(BlueprintTask);
          expect(TaskFabrik.getTask.bind(TaskFabrik, 'Invalid')).to.throw(AssertionError);
        });
        it('gets Task status successfully', () => {});
        it('updates Task state successfully', () => {});
      });
    });
  });
});