'use strict';

const Promise = require('bluebird');
const Task = require('../../operators/serviceflow-operator/task/Task');
const apiServerClient = require('../../data-access-layer/eventmesh').apiServerClient;
const CONST = require('../../common/constants');
const NotImplementedBySubclass = require('../../common/errors').NotImplementedBySubclass;

describe('operators', function () {
  describe('ServiceFlow', function () {
    describe('tasks', function () {
      describe('Task', function () {
        const instanceId = 'bc158c9a-7934-401e-94ab-057082abcde';
        const taskId = 'bc158c9a-7934-401e-94ab-057082abcd';
        let apiServerClientUpdateStub, apiServerClientLastOpStub;
        const taskDetails = {
          operation_params: {
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
            parameters: {
              multi_az: true
            }
          },
          serviceflow_id: 'bc158c9a-7934-401e-94ab-057082abcde',
          serviceflow_name: 'BLUEPRINT_SERVICEFLOW',
          task_description: 'TEST_TASK',
          instance_id: instanceId
        };
        before(function () {
          apiServerClientUpdateStub = sinon.stub(apiServerClient, 'updateResource', () => Promise.resolve(taskDetails));
          apiServerClientLastOpStub = sinon.stub(apiServerClient, 'getResourceStatus', () => Promise.resolve({
            state: CONST.OPERATION.IN_PROGRESS,
            description: 'Task in Progress..'
          }));
        });
        after(function () {
          apiServerClientUpdateStub.restore();
          apiServerClientLastOpStub.restore();
        });
        it('throws exception when run invoked', () => {
          expect(Task.run.bind(Task, taskId, taskDetails)).to.throw(NotImplementedBySubclass);
        });
        it('gets Task status successfully', () => {
          taskDetails.resource = {
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            resourceId: instanceId
          };
          return Task.getStatus(taskId, taskDetails)
            .then(taskResponse => {
              expect(taskResponse).to.eql({
                state: CONST.OPERATION.IN_PROGRESS,
                description: 'Task in Progress..'
              });
            });
        });
        it('updates Task state successfully', () => {
          taskDetails.resource = {
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
            resourceId: instanceId
          };
          const status = {
            state: CONST.OPERATION.SUCCEEDED,
            description: 'Task complete.'
          };
          return Task.updateStatus(taskDetails.resource, status).then(() => {
            expect(apiServerClientUpdateStub.firstCall.args[0].status).to.eql({
              lastOperation: status,
              response: undefined,
              state: CONST.OPERATION.SUCCEEDED
            });
          });
        });
      });
    });
  });
});