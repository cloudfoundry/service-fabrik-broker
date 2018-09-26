'use strict';

const _ = require('lodash');
const CONST = require('../../common/constants');
const proxyquire = require('proxyquire');
const BackupService = require('../../managers/backup-manager');

describe('managers', function () {
  describe('BackupStatusPoller', function () {

    /* jshint expr:true */
    const index = mocks.director.networkSegmentIndex;
    const time = Date.now();
    const IN_PROGRESS_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180be';
    const SUCCEEDED_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180bs';
    const ABORTING_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180ba';
    const UNLOCK_FAILED_BACKUP_GUID = '071acb05-66a3-471b-af3c-8bbf1e4180bc';
    let instanceInfo = {
      tenant_id: 'e7c0a437-7585-4d75-addf-aa4d45b49f3a',
      instance_guid: mocks.director.uuidByIndex(index),
      agent_ip: '10.10.0.15',
      service_id: '24731fb8-7b84-4f57-914f-c3d55d793dd4',
      plan_id: 'bc158c9a-7934-401e-94ab-057082a5073f',
      deployment: mocks.director.deploymentNameByIndex(index),
      started_at: time
    };
    const deploymentName = instanceInfo.deployment;
    const config = {
      enable_service_fabrik_v2: true,
      backup: {
        status_check_every: 10,
        abort_time_out: 180000,
        retry_delay_on_error: 10,
        lock_check_delay_on_restart: 0
      }
    };
    const BackupStatusPoller = proxyquire('../../managers/backup-manager/BackupStatusPoller.js', {
      '../../common/config': config
    });
    const instanceInfo_InProgress = _.clone(instanceInfo);
    _.set(instanceInfo_InProgress, 'backup_guid', IN_PROGRESS_BACKUP_GUID);
    const instanceInfo_Succeeded = _.clone(instanceInfo);
    _.set(instanceInfo_Succeeded, 'backup_guid', SUCCEEDED_BACKUP_GUID);
    const instanceInfo_aborting = _.clone(instanceInfo);
    _.set(instanceInfo_aborting, 'backup_guid', ABORTING_BACKUP_GUID);
    const instanceInfo_unlock_failed = _.clone(instanceInfo);
    _.set(instanceInfo_unlock_failed, 'backup_guid', UNLOCK_FAILED_BACKUP_GUID);

    function getJobBasedOnOperation(operationName, add_instanceInfo) {
      const job = {
        attrs: {
          name: `${deploymentName}_${operationName}_${add_instanceInfo.backup_guid}_${CONST.JOB.BNR_STATUS_POLLER}`,
          data: {
            _n_a_m_e_: `${deploymentName}_${operationName}_${add_instanceInfo.backup_guid}_${CONST.JOB.BNR_STATUS_POLLER}`,
            type: CONST.BACKUP.TYPE.ONLINE,
            trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
            operation: operationName,
            operation_details: _.assign(instanceInfo, add_instanceInfo)
          },
          lastRunAt: new Date(),
          nextRunAt: new Date(),
          repeatInterval: '*/1 * * * *',
          lockedAt: null,
          repeatTimezone: 'America/New_York'
        },
        fail: () => undefined,
        save: () => undefined,
        touch: () => undefined
      };
      return job;
    }

    let sandbox, backupOperationStub;
    before(function () {
      sandbox = sinon.sandbox.create();
      backupOperationStub = sandbox.stub(BackupService.prototype, 'getOperationState');
    });

    afterEach(function () {
      backupOperationStub.reset();
    });

    after(function () {
      sandbox.restore();
    });

    describe('#checkOperationCompletionStatus', function () {
      it('backup status check should be succesful and status is succeeded', function () {
        backupOperationStub.withArgs('backup', instanceInfo_Succeeded).onCall(0).returns(Promise.resolve({
          state: CONST.OPERATION.SUCCEEDED,
          description: 'Backup operation successful'
        }));
        const opts = _.cloneDeep(instanceInfo_Succeeded);
        opts.backup_guid = SUCCEEDED_BACKUP_GUID;
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, SUCCEEDED_BACKUP_GUID, {});
        return BackupStatusPoller.checkOperationCompletionStatus(opts)
          .then(res => {
            expect(res).to.eql({
              state: CONST.OPERATION.SUCCEEDED,
              description: 'Backup operation successful'
            });
            expect(backupOperationStub).to.be.calledOnce;
            mocks.verify();
          });
      });

      it('backup status check should be succesful and status is processing', function () {
        backupOperationStub.withArgs('backup', instanceInfo_InProgress).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS,
          description: 'Backup operation in-progress'
        }));
        const opts = _.cloneDeep(instanceInfo_InProgress);
        opts.backup_guid = IN_PROGRESS_BACKUP_GUID;
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, IN_PROGRESS_BACKUP_GUID, {
          'status': {
            'response': JSON.stringify({
              'fakeKey': 'fakeValue'
            })
          }
        });
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, IN_PROGRESS_BACKUP_GUID, {});
        return BackupStatusPoller.checkOperationCompletionStatus(opts)
          .then(res => {
            expect(res).to.eql({
              state: CONST.OPERATION.IN_PROGRESS,
              description: 'Backup operation in-progress'
            });
            expect(backupOperationStub).to.be.calledOnce;
            mocks.verify();
          });
      });

      it('backup is processing - exceeded deployment lock timeout', function () {
        backupOperationStub.withArgs('backup', instanceInfo_InProgress).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS,
          description: 'Backup operation in-progress'
        }));
        const oldTTLConfig = config.lockttl.backup;
        config.lockttl.backup = 0;
        const opts = _.cloneDeep(instanceInfo_InProgress);
        opts.backup_guid = IN_PROGRESS_BACKUP_GUID;
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, IN_PROGRESS_BACKUP_GUID, {
          'status': {
            'response': JSON.stringify({
              'fakeKey': 'fakeValue'
            })
          }
        }, 2);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, IN_PROGRESS_BACKUP_GUID, {}, 2);
        return BackupStatusPoller.checkOperationCompletionStatus(opts)
          .then(res => {
            expect(res).to.eql({
              state: CONST.APISERVER.RESOURCE_STATE.ABORTING,
              description: 'Backup operation in-progress'
            });
            config.lockttl.backup = oldTTLConfig;
            expect(backupOperationStub).to.be.calledOnce;
            mocks.verify();
          });
      });

      it('backup is aborting - within abort timeout', function () {
        const oldTTLConfig = config.lockttl.backup;
        config.lockttl.backup = 0;
        const job = getJobBasedOnOperation('backup', {
          backup_guid: IN_PROGRESS_BACKUP_GUID,
          abortStartTime: new Date().toISOString()
        });
        backupOperationStub.withArgs('backup', job.attrs.data.operation_details).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS,
          description: 'Backup operation in-progress'
        }));
        const opts = _.cloneDeep(job.attrs.data.operation_details);
        opts.backup_guid = IN_PROGRESS_BACKUP_GUID;
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, IN_PROGRESS_BACKUP_GUID, {
          'status': {
            'response': JSON.stringify({
              'fakeKey': 'fakeValue'
            })
          }
        });
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, IN_PROGRESS_BACKUP_GUID, {});
        return BackupStatusPoller.checkOperationCompletionStatus(opts)
          .then(res => {
            expect(res).to.eql({
              state: CONST.APISERVER.RESOURCE_STATE.ABORTING,
              description: 'Backup operation in-progress'
            });
            config.lockttl.backup = oldTTLConfig;
            expect(backupOperationStub).to.be.calledOnce;
            mocks.verify();
          });
      });

      it('backup is aborting - abort timeout exceeded', function () {
        const oldAbortTimeConfig = config.backup.abort_time_out;
        const oldTTLConfig = config.lockttl.backup;
        config.backup.abort_time_out = 0;
        config.lockttl.backup = 0;
        const job = getJobBasedOnOperation('backup', {
          backup_guid: ABORTING_BACKUP_GUID,
          abortStartTime: new Date().toISOString()
        });
        backupOperationStub.withArgs('backup', job.attrs.data.operation_details).onCall(0).returns(Promise.resolve({
          state: CONST.OPERATION.ABORTING,
          description: 'Backup operation abort in-progress'
        }));
        const opts = _.cloneDeep(job.attrs.data.operation_details);
        opts.backup_guid = ABORTING_BACKUP_GUID;
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, ABORTING_BACKUP_GUID, {
          'status': {
            'response': JSON.stringify({
              'fakeKey': 'fakeValue'
            })
          }
        });
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, ABORTING_BACKUP_GUID, {}, 2);
        return BackupStatusPoller.checkOperationCompletionStatus(opts)
          .then(res => {
            expect(res).to.eql({
              state: CONST.APISERVER.RESOURCE_STATE.ABORTED,
              description: 'Backup operation abort in-progress'
            });
            config.lockttl.backup = oldTTLConfig;
            config.backup.abort_time_out = oldAbortTimeConfig;
            expect(backupOperationStub).to.be.calledOnce;
            mocks.verify();
          });
      });
    });
  });
});