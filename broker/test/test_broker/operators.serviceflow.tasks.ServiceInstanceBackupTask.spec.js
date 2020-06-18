'use strict';

const Promise = require('bluebird');
const ServiceInstanceBackupTask = require('../../applications/operators/src/serviceflow-operator/task/ServiceInstanceBackupTask');
const { apiServerClient } = require('@sf/eventmesh');
const {
  CONST,
  commonFunctions
} = require('@sf/common-utils');

describe('operators', function () {
  describe('ServiceFlow', function () {
    describe('tasks', function () {
      describe('ServiceInstanceBackupTask', function () {
        const instanceId = 'bc158c9a-7934-401e-94ab-057082abcde';
        const taskId = 'bc158c9a-7934-401e-94ab-057082abcd';
        let apiServerClientUpdateStub, utilsStub;
        const taskDetails = {
          operation_params: {
            plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
            parameters: {
              major_version_update: true
            }
          },
          serviceflow_id: 'bc158c9a-7934-401e-94ab-057082abcde',
          serviceflow_name: 'major_version_upgrade',
          task_description: 'Instance backup prior to version upgrade',
          instance_id: instanceId,
          user: CONST.SYSTEM_USER
        };
        before(function () {
          apiServerClientUpdateStub = sinon.stub(apiServerClient, 'createResource').callsFake(() => Promise.resolve(taskDetails));
          utilsStub = sinon.stub(commonFunctions, 'uuidV4').callsFake(() => Promise.resolve(taskId));
        });
        after(function () {
          apiServerClientUpdateStub.restore();
          utilsStub.restore();
        });
        it('runs instance update successfully', () => {
          return ServiceInstanceBackupTask.run(taskId, taskDetails)
            .then(taskResponse => {
              expect(taskResponse.resource).to.eql({
                resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
                resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
                resourceId: taskId
              });
              expect(taskResponse.response.description.indexOf('Instance backup prior to version upgrade initiated successfully') === 0).to.equal(true);
            });
        });
      });
    });
  });
});
