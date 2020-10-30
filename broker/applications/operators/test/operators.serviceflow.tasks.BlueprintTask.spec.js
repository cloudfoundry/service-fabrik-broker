'use strict';

const Promise = require('bluebird');
const BlueprintTask = require('../src/serviceflow-operator/task/BlueprintTask');
const { apiServerClient } = require('@sf/eventmesh');
const { CONST } = require('@sf/common-utils');

describe('operators', function () {
  describe('ServiceFlow', function () {
    describe('tasks', function () {
      describe('BlueprintTask', function () {
        const instanceId = 'bc158c9a-7934-401e-94ab-057082abcde';
        const taskId = 'bc158c9a-7934-401e-94ab-057082abcd';
        let apiServerClientUpdateStub;
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
          apiServerClientUpdateStub = sinon.stub(apiServerClient, 'updateResource').callsFake(() => Promise.resolve(taskDetails));
        });
        after(function () {
          apiServerClientUpdateStub.restore();
        });
        it('runs bp task successfully', () => {
          return BlueprintTask.run(taskId, taskDetails)
            .then(taskResponse => {
              expect(taskResponse.resource).to.eql({
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.SERVICE_FLOW, // 'RG Of the resource which Task is executing',
                resourceType: CONST.APISERVER.RESOURCE_TYPES.TASK, // 'Type of the resource which Task is executing',
                resourceId: 'bp_task' // 'Resource ID of the resource which would be getting created by the task in this run method'
              });
              expect(taskResponse.response.description).to.equal('Task Run initiated successfully... Wait for poll to complete status.');
            });
        });
        it('gets bp task status successfully', () => {
          return BlueprintTask.getStatus(taskId, taskDetails)
            .then(taskResponse => {
              expect(taskResponse).to.eql({
                state: CONST.OPERATION.SUCCEEDED,
                description: 'Blueprint Task succeeded!'
              });
            });
        });
      });
    });
  });
});
