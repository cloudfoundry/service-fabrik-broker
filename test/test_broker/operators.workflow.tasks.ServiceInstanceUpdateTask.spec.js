'use strict';

const Promise = require('bluebird');
const ServiceInstanceUpdateTask = require('../../operators/workflow-operator/task/ServiceInstanceUpdateTask');
const apiServerClient = require('../../data-access-layer/eventmesh').apiServerClient;
const CONST = require('../../common/constants');

describe('operators', function () {
  describe('workflow', function () {
    describe('tasks', function () {
      describe('ServiceInstanceUpdateTask', function () {
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
          workflow_id: 'bc158c9a-7934-401e-94ab-057082abcde',
          workflow_name: 'upgrade_to_multi_az',
          task_description: 'TEST_TASK',
          instance_id: instanceId
        };
        before(function () {
          apiServerClientUpdateStub = sinon.stub(apiServerClient, 'updateResource', () => Promise.resolve(taskDetails));
        });
        after(function () {
          apiServerClientUpdateStub.restore();
        });
        it('runs instance update successfully', () => {
          return ServiceInstanceUpdateTask.run(taskId, taskDetails)
            .then(taskResponse => {
              expect(taskResponse.resource).to.eql({
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
                resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
                resourceId: instanceId
              });
              expect(taskResponse.response.description.indexOf('TEST_TASK initiated successfully') === 0).to.equal(true);
            });
        });
      });
    });
  });
});