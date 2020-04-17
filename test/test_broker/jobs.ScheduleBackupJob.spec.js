'use strict';

const _ = require('lodash');
const {
  CONST,
  errors: {
    ServiceUnavailable
  }
} = require('@sf/common-utils');
const config = require('@sf/app-config');
const moment = require('moment');
const Promise = require('bluebird');
const ScheduleManager = require('../../core/scheduler-jobs/src/ScheduleManager');
const JobFabrik = require('../../core/scheduler-jobs/src/jobs/JobFabrik');
const BaseJob = require('../../core/scheduler-jobs/src/jobs/BaseJob');
const { 
  backupStore,
  CloudProviderClient
} = require('@sf/iaas');
const filename = backupStore.filename;

describe('Jobs', function () {
  /* jshint expr:true */

  describe('ScheduleBackupJob', function () {
    const ScheduleBackupJob = JobFabrik.getJob(CONST.JOB.SCHEDULED_BACKUP);

    describe('#RunBackup', function () {
      const index = mocks.director.networkSegmentIndex;
      const instance_id = mocks.director.uuidByIndex(index);
      const failed_instance_id = mocks.director.uuidByIndex(22);
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const service_name = 'blueprint';
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
      const backup_guid2 = '081acb05-66a3-471b-af3c-8bbf1e4180bf';
      const backup_guid3 = '091acb05-66a3-471b-af3c-8bbf1e4180bg';
      const backup_guid16 = '061acb05-66a3-471b-af3c-8bbf1e4180be';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const container = backupStore.containerName;
      const serviceContainer = 'cf.service-fabrik.myopenstack.com-service-fabrik-blueprint';
      const started1DaysPrior = filename.isoDate(moment().subtract(1, 'days').toISOString());
      const started18DaysPrior = filename.isoDate(moment()
        .subtract(config.backup.retention_period_in_days + 4, 'days').toISOString());
      const started16DaysPrior = filename.isoDate(moment()
        .subtract(config.backup.retention_period_in_days + 2, 'days').toISOString());
      const started14DaysPrior = filename.isoDate(moment()
        .subtract(config.backup.retention_period_in_days + 1, 'days').toISOString());
      const prefix = `${space_guid}/backup/${service_id}.${instance_id}`;
      const transactionLogsPrefix = `${service_name}/logs/${instance_id}`;
      const transactionLogsPrefixFailedInstance = `${service_name}/logs/${failed_instance_id}`;
      const failed_prefix = `${space_guid}/backup/${service_id}.${failed_instance_id}`;
      const fileName1Daysprior = `${prefix}.${backup_guid3}.${started1DaysPrior}.json`;
      const fileName14Daysprior = `${prefix}.${backup_guid}.${started14DaysPrior}.json`;
      const fileName16DaysPrior = `${prefix}.${backup_guid16}.${started16DaysPrior}.json`;
      const fileName18DaysPrior = `${prefix}.${backup_guid2}.${started18DaysPrior}.json`;
      const transactionLogsFileName1Daysprior = `${transactionLogsPrefix}/1-day-prior.bson`;
      const transactionLogsFileName19Daysprior = `${transactionLogsPrefix}/19-days-prior.bson`;
      const transactionLogsFileName16DaysPrior = `${transactionLogsPrefix}/16-days-prior.bson`;
      const transactionLogsFileName18DaysPrior = `${transactionLogsPrefix}/18-days-prior.bson`;
      const transactionLogsFileName14DaysPrior = `${transactionLogsPrefix}/14-days-prior.bson`;
      const pathname14 = `/${container}/${fileName14Daysprior}`;
      const pathname16 = `/${container}/${fileName16DaysPrior}`;
      const pathname18 = `/${container}/${fileName18DaysPrior}`;
      const transactionLogsPathname19 = `/${serviceContainer}/${transactionLogsFileName19Daysprior}`;
      const transactionLogsPathname16 = `/${serviceContainer}/${transactionLogsFileName16DaysPrior}`;
      const transactionLogsPathname18 = `/${serviceContainer}/${transactionLogsFileName18DaysPrior}`;
      const dummyDeploymentResource = {
        spec: {
          options: JSON.stringify({
            service_id: service_id,
            plan_id: plan_id,
            context: {
              platform: 'cloudfoundry'
            },
            space_guid: space_guid
          })
        }
      };
      const scheduled_data = {
        trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
        type: 'online',
        state: 'succeeded',
        backup_guid: backup_guid,
        started_at: started14DaysPrior,
        agent_ip: mocks.agent.ip,
        service_id: service_id
      };
      const scheduled_data16 = {
        trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
        type: 'online',
        state: 'succeeded',
        backup_guid: backup_guid16,
        started_at: started16DaysPrior,
        agent_ip: mocks.agent.ip,
        service_id: service_id
      };
      const ondemand_data = {
        trigger: CONST.BACKUP.TRIGGER.ON_DEMAND,
        type: 'online',
        state: 'succeeded',
        backup_guid: backup_guid2,
        started_at: started18DaysPrior,
        agent_ip: mocks.agent.ip,
        service_id: service_id
      };

      function getBackupData(backupGuid, trigger_type, startedAt, stateOfBackup) {
        return {
          trigger: trigger_type,
          type: 'online',
          state: stateOfBackup,
          backup_guid: backupGuid,
          started_at: startedAt,
          agent_ip: mocks.agent.ip,
          service_id: service_id
        };
      }
      let saveJobFailure = false;
      const job = {
        attrs: {
          data: {
            instance_id: instance_id,
            type: 'online',
            trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
            tenant_id: space_guid,
            service_id: service_id,
            plan_id: plan_id,
            _n_a_m_e_: `${instance_id}_${CONST.JOB.SCHEDULED_BACKUP}`,
            attempt: 1
          },
          lastRunAt: new Date(),
          nextRunAt: new Date(),
          repeatInterval: '*/1 * * * *',
          lockedAt: null,
          repeatTimezone: 'America/New_York'
        },
        fail: () => undefined,
        save: () => {
          if (saveJobFailure) {
            throw new Error('Some internal agenda Error');
          }
          return;
        }
      };
      let baseJobLogRunHistoryStub, cancelScheduleStub, runAtStub, scheduleStub, delayStub;

      before(function () {
        backupStore.cloudProvider = new CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        baseJobLogRunHistoryStub = sinon.stub(BaseJob, 'logRunHistory');
        baseJobLogRunHistoryStub.withArgs().returns(Promise.resolve({}));
        delayStub = sinon.stub(Promise, 'delay').callsFake(() => Promise.resolve());
        cancelScheduleStub = sinon.stub(ScheduleManager, 'cancelSchedule');
        cancelScheduleStub.withArgs(failed_instance_id).returns(Promise.reject(new ServiceUnavailable('Scheduler Unavailable')));
        cancelScheduleStub.returns(Promise.resolve({}));
        runAtStub = sinon.stub(ScheduleManager, 'runAt');
        runAtStub.withArgs(failed_instance_id).throws(new ServiceUnavailable('Scheduler Unavailable'));
        runAtStub.returns(Promise.resolve({}));
        scheduleStub = sinon.stub(ScheduleManager, 'schedule');
        scheduleStub.withArgs(failed_instance_id).throws(new ServiceUnavailable('Scheduler Unavailable'));
        scheduleStub.returns(Promise.resolve({}));
        return mocks.setup([backupStore.cloudProvider.getContainer()]);
      });

      afterEach(function () {
        job.attrs.data.instance_id = instance_id;
        baseJobLogRunHistoryStub.resetHistory();
        cancelScheduleStub.resetHistory();
        runAtStub.resetHistory();
        scheduleStub.resetHistory();
        delayStub.resetHistory();
        job.attrs.data.attempt = 1;
        saveJobFailure = false;
      });

      after(function () {
        baseJobLogRunHistoryStub.restore();
        cancelScheduleStub.restore();
        runAtStub.restore();
        scheduleStub.restore();
        delayStub.restore();
      });

      it('should initiate backup, delete scheduled backup and transaction logs older than 14+1 days & should not delete on-demand backup', function () {
        const backupResponse = {
          backup_guid: backup_guid
        };
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
        mocks.serviceFabrikClient.startBackup(instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, backupResponse);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior,
          fileName16DaysPrior,
          fileName18DaysPrior,
          fileName1Daysprior
        ]);
        mocks.cloudProvider.listBlobs(serviceContainer, transactionLogsPrefix, [{
          file_name: transactionLogsFileName1Daysprior,
          last_modified: Date.now() - 1 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName19Daysprior,
          last_modified: Date.now() - 19 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName16DaysPrior,
          last_modified: Date.now() - 16 * 60 * 60 * 24 * 1000 - 30 * 60 * 1000 // 3 mins = buffer time
        },
        {
          file_name: transactionLogsFileName14DaysPrior,
          last_modified: Date.now() - 14 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName18DaysPrior,
          last_modified: Date.now() - 18 * 60 * 60 * 24 * 1000
        }
        ]);
        // Out of 4 files 1 and 14 day prior is filtered out 
        // & the 18 day prior on demand will not be deleted
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.download(pathname16, scheduled_data16);
        mocks.cloudProvider.download(pathname18, ondemand_data);
        mocks.cloudProvider.remove(transactionLogsPathname19);
        mocks.cloudProvider.remove(transactionLogsPathname18);
        mocks.cloudProvider.remove(transactionLogsPathname16);
        mocks.serviceFabrikClient.deleteBackup(backup_guid16, space_guid, false);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const expectedBackupResponse = {
            start_backup_status: {
              name: 'backup',
              guid: backupResponse.backup_guid
            },
            delete_backup_status: {
              deleted_guids: [backup_guid16, undefined],
              job_cancelled: false,
              instance_deleted: false,
              deleted_transaction_log_files_count: 3
            }
          };
          expect(baseJobLogRunHistoryStub).to.be.calledTwice;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it('should initiate backup, should delete scheduled backup older than 15 days and transaction logs older than the latest successful backup before retention-period, beyond one successful backup', function () {
        const backupResponse = {
          backup_guid: backup_guid
        };
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
        mocks.serviceFabrikClient.startBackup(instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, backupResponse);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior,
          fileName16DaysPrior,
          fileName18DaysPrior,
          fileName1Daysprior
        ]);
        mocks.cloudProvider.listBlobs(serviceContainer, transactionLogsPrefix, [{
          file_name: transactionLogsFileName1Daysprior,
          last_modified: Date.now() - 1 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName19Daysprior,
          last_modified: Date.now() - 19 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName16DaysPrior,
          last_modified: Date.now() - 16 * 60 * 60 * 24 * 1000 - 30 * 60 * 1000 // 30 mins = buffer time
        },
        {
          file_name: transactionLogsFileName14DaysPrior,
          last_modified: Date.now() - 14 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName18DaysPrior,
          last_modified: Date.now() - 18 * 60 * 60 * 24 * 1000
        }
        ]);
        // Out of 4 files 1 and 14 day prior is filtered out 
        // & the 18 day prior on demand will not be deleted
        mocks.cloudProvider.download(pathname14,
          getBackupData(backup_guid, CONST.BACKUP.TRIGGER.SCHEDULED, started14DaysPrior, CONST.OPERATION.FAILED));
        mocks.cloudProvider.download(pathname16,
          getBackupData(backup_guid16, CONST.BACKUP.TRIGGER.SCHEDULED, started16DaysPrior, CONST.OPERATION.SUCCEEDED));
        mocks.cloudProvider.download(pathname18,
          getBackupData(backup_guid2, CONST.BACKUP.TRIGGER.SCHEDULED, started18DaysPrior, CONST.OPERATION.SUCCEEDED));
        mocks.serviceFabrikClient.deleteBackup(backup_guid2, space_guid, false);
        mocks.cloudProvider.remove(transactionLogsPathname19);
        mocks.cloudProvider.remove(transactionLogsPathname18);
        mocks.cloudProvider.remove(transactionLogsPathname16);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const expectedBackupResponse = {
            start_backup_status: {
              name: 'backup',
              guid: backupResponse.backup_guid
            },
            delete_backup_status: {
              deleted_guids: [backup_guid2],
              deleted_transaction_log_files_count: 3,
              job_cancelled: false,
              instance_deleted: false
            }
          };
          expect(baseJobLogRunHistoryStub).to.be.calledTwice;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it('should initiate backup, should not delete backups or transaction logs even older than 15 days when successful backup is oldest', function () {
        const backupResponse = {
          backup_guid: backup_guid
        };
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
        mocks.serviceFabrikClient.startBackup(instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, backupResponse);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior,
          fileName16DaysPrior,
          fileName18DaysPrior,
          fileName1Daysprior
        ]);
        mocks.cloudProvider.listBlobs(serviceContainer, transactionLogsPrefix, [{
          file_name: transactionLogsFileName1Daysprior,
          last_modified: Date.now() - 1 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName19Daysprior,
          last_modified: Date.now() - 19 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName16DaysPrior,
          last_modified: Date.now() - 16 * 60 * 60 * 24 * 1000 - 30 * 60 * 1000 // 30 mins = buffer time
        },
        {
          file_name: transactionLogsFileName14DaysPrior,
          last_modified: Date.now() - 14 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName18DaysPrior,
          last_modified: Date.now() - 18 * 60 * 60 * 24 * 1000 - 30 * 60 * 1000 // 30 mins = buffer time
        }
        ]);
        // Out of 4 files 1 day prior is filtered out.
        mocks.cloudProvider.download(pathname14,
          getBackupData(backup_guid, CONST.BACKUP.TRIGGER.SCHEDULED, started14DaysPrior, CONST.OPERATION.FAILED));
        mocks.cloudProvider.download(pathname16,
          getBackupData(backup_guid16, CONST.BACKUP.TRIGGER.SCHEDULED, started16DaysPrior, CONST.OPERATION.FAILED));
        mocks.cloudProvider.download(pathname18,
          getBackupData(backup_guid2, CONST.BACKUP.TRIGGER.SCHEDULED, started18DaysPrior, CONST.OPERATION.SUCCEEDED));
        mocks.cloudProvider.remove(transactionLogsPathname19);
        mocks.cloudProvider.remove(transactionLogsPathname18);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const expectedBackupResponse = {
            start_backup_status: {
              name: 'backup',
              guid: backupResponse.backup_guid
            },
            delete_backup_status: {
              deleted_guids: [],
              deleted_transaction_log_files_count: 2,
              job_cancelled: false,
              instance_deleted: false
            }
          };
          expect(baseJobLogRunHistoryStub).to.be.calledTwice;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it('should initiate backup, should  delete backups and transaction logs older than 15 days when unsuccessful', function () {
        const backupResponse = {
          backup_guid: backup_guid
        };
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
        mocks.serviceFabrikClient.startBackup(instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, backupResponse);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior,
          fileName16DaysPrior,
          fileName18DaysPrior,
          fileName1Daysprior
        ]);
        mocks.cloudProvider.listBlobs(serviceContainer, transactionLogsPrefix, [{
          file_name: transactionLogsFileName1Daysprior,
          last_modified: Date.now() - 1 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName19Daysprior,
          last_modified: Date.now() - 19 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName16DaysPrior,
          last_modified: Date.now() - 16 * 60 * 60 * 24 * 1000 - 30 * 60 * 1000 // 30 mins = buffer time
        },
        {
          file_name: transactionLogsFileName14DaysPrior,
          last_modified: Date.now() - 14 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName18DaysPrior,
          last_modified: Date.now() - 18 * 60 * 60 * 24 * 1000
        }
        ]);
        // Out of 4 files 1 day prior is filtered out.
        mocks.cloudProvider.download(pathname14,
          getBackupData(backup_guid, CONST.BACKUP.TRIGGER.SCHEDULED, started14DaysPrior, CONST.OPERATION.FAILED));
        mocks.cloudProvider.download(pathname16,
          getBackupData(backup_guid16, CONST.BACKUP.TRIGGER.SCHEDULED, started16DaysPrior, CONST.OPERATION.FAILED));
        mocks.cloudProvider.download(pathname18,
          getBackupData(backup_guid2, CONST.BACKUP.TRIGGER.SCHEDULED, started18DaysPrior, CONST.OPERATION.FAILED));
        mocks.serviceFabrikClient.deleteBackup(backup_guid, space_guid, false);
        mocks.serviceFabrikClient.deleteBackup(backup_guid2, space_guid, false);
        mocks.serviceFabrikClient.deleteBackup(backup_guid16, space_guid, false);
        // Deletes transactionLogs older than retention period only. Hence, transactionLog older than 1 day is not deleted.
        mocks.cloudProvider.remove(transactionLogsPathname19);
        mocks.cloudProvider.remove(transactionLogsPathname18);
        mocks.cloudProvider.remove(transactionLogsPathname16);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const expectedBackupResponse = {
            start_backup_status: {
              name: 'backup',
              guid: backupResponse.backup_guid
            },
            delete_backup_status: {
              deleted_guids: [backup_guid, backup_guid16, backup_guid2],
              deleted_transaction_log_files_count: 3,
              job_cancelled: false,
              instance_deleted: false
            }
          };
          expect(baseJobLogRunHistoryStub).to.be.calledTwice;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it('delete transaction logs older than 15 days if no successful backups are present', function () {
        const backupResponse = {
          backup_guid: backup_guid
        };
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
        mocks.serviceFabrikClient.startBackup(instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, backupResponse);
        mocks.cloudProvider.list(container, prefix, []);
        mocks.cloudProvider.listBlobs(serviceContainer, transactionLogsPrefix, [{
          file_name: transactionLogsFileName1Daysprior,
          last_modified: Date.now() - 1 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName19Daysprior,
          last_modified: Date.now() - 19 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName16DaysPrior,
          last_modified: Date.now() - 16 * 60 * 60 * 24 * 1000 - 30 * 60 * 1000 // 30 mins = buffer time
        },
        {
          file_name: transactionLogsFileName14DaysPrior,
          last_modified: Date.now() - 14 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName18DaysPrior,
          last_modified: Date.now() - 18 * 60 * 60 * 24 * 1000
        }
        ]);
        // Deletes transactionLogs older than retention period only. Hence, transactionLog older than 1 day is not deleted.
        mocks.cloudProvider.remove(transactionLogsPathname19);
        mocks.cloudProvider.remove(transactionLogsPathname18);
        mocks.cloudProvider.remove(transactionLogsPathname16);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const expectedBackupResponse = {
            start_backup_status: {
              name: 'backup',
              guid: backupResponse.backup_guid
            },
            delete_backup_status: {
              deleted_guids: [],
              deleted_transaction_log_files_count: 3,
              job_cancelled: false,
              instance_deleted: false
            }
          };
          expect(baseJobLogRunHistoryStub).to.be.calledTwice;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedBackupResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it('should log start backup as failed', function () {
        mocks.serviceFabrikClient.startBackup(instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, {
          status: 500
        });
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const errStatusCode = 500;
          const backupRunStatus = {
            start_backup_status: 'failed',
            delete_backup_status: 'failed'
          };
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('InternalServerError');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(errStatusCode);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(backupRunStatus);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it(`If an update is in progress while backup is initiated, then the backup Job must be rescheduled to run again after delay of : ${config.scheduler.jobs.reschedule_delay}`, function () {
        mocks.serviceFabrikClient.startBackup(instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, {
          status: 409
        });
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
        return ScheduleBackupJob.run(job, () => {})
          .then(() => {
            mocks.verify();
            const errStatusCode = 409;
            const backupRunStatus = {
              start_backup_status: 'failed',
              delete_backup_status: 'failed'
            };
            expect(baseJobLogRunHistoryStub).to.be.calledOnce;
            expect(scheduleStub).to.be.calledOnce;
            expect(scheduleStub.firstCall.args[0]).to.eql(instance_id);
            expect(scheduleStub.firstCall.args[1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
            expect(RegExp('[0-9]+ [0-9]+[\,]{1}[0-9]+[\,]{1}[0-9]+ \* \* \*').test(scheduleStub.firstCall.args[2])).to.be.eql(true);
            const expectedJobData = _.clone(job.attrs.data);
            expectedJobData.attempt = 2;
            expect(scheduleStub.firstCall.args[3]).to.eql(expectedJobData);
            expect(scheduleStub.firstCall.args[4]).to.eql(CONST.SYSTEM_USER);
            expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('Conflict');
            expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(errStatusCode);
            expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(backupRunStatus);
            expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
            expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          });
      });
      it(`If a backup fails for more than ${config.scheduler.jobs.scheduled_backup.max_attempts} attempts, then the scheduler should throw and error and then gracefully exit`, function () {
        job.attrs.data.instance_id = failed_instance_id;
        const max_attmpts = config.scheduler.jobs.scheduled_backup.max_attempts;
        mocks.serviceFabrikClient.startBackup(failed_instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, {
          status: 409
        });
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, failed_instance_id, dummyDeploymentResource);
        return ScheduleBackupJob.run(_.chain(_.cloneDeep(job)).set('attrs.data.attempt', max_attmpts).value(), () => {})
          .then(() => {
            mocks.verify();
            const backupRunStatus = {
              start_backup_status: 'failed',
              delete_backup_status: 'failed'
            };
            expect(baseJobLogRunHistoryStub).to.be.calledOnce;
            expect(scheduleStub.callCount).to.be.eql(3); // Retry mechanism to schedule runAt is 3 times on error
            expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('Conflict');
            expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(backupRunStatus);
            expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(_.chain(_.cloneDeep(job.attrs)).set('data.attempt', max_attmpts).value());
            expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
            config.scheduler.jobs.scheduled_backup.max_attempts = max_attmpts;
          });
      });
      it('If error occurs while rescheduling job due to a backup run, same must be retried and then gracefully exit', function () {
        job.attrs.data.instance_id = failed_instance_id;
        const max_attmpts = config.scheduler.jobs.scheduled_backup.max_attempts;
        mocks.serviceFabrikClient.startBackup(failed_instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, {
          status: 409
        });
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, failed_instance_id, dummyDeploymentResource);
        return ScheduleBackupJob.run(job, () => {})
          .then(() => {
            mocks.verify();
            const backupRunStatus = {
              start_backup_status: 'failed',
              delete_backup_status: 'failed'
            };
            expect(baseJobLogRunHistoryStub).to.be.calledOnce;
            expect(scheduleStub.callCount).to.be.eql(3); // Retry mechanism to schedule runAt is 3 times on error
            expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('Conflict');
            expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(backupRunStatus);
            expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
            expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
            config.scheduler.jobs.scheduled_backup.max_attempts = max_attmpts;
          });
      });
      it('should log delete backup as failed', function () {
        const backupResponse = {
          backup_guid: backup_guid
        };
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, dummyDeploymentResource);
        mocks.serviceFabrikClient.startBackup(instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, backupResponse);
        mocks.cloudProvider.list(container, prefix, [], 404);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const errStatusCode = 404;
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          const expectedJobResponse = {
            start_backup_status: {
              name: 'backup',
              guid: backup_guid
            },
            delete_backup_status: 'failed'
          };
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('Error');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].statusCode).to.eql(errStatusCode);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedJobResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it('should delete scheduled backup & any on-demand backups even when service instance is deleted', function () {
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, 404);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior,
          fileName16DaysPrior,
          fileName18DaysPrior,
          fileName1Daysprior
        ]);
        mocks.cloudProvider.listBlobs(serviceContainer, transactionLogsPrefix, [{
          file_name: transactionLogsFileName1Daysprior,
          last_modified: Date.now() - 1 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName19Daysprior,
          last_modified: Date.now() - 19 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName16DaysPrior,
          last_modified: Date.now() - 16 * 60 * 60 * 24 * 1000 - 30 * 60 * 1000 // 30 mins = buffer time
        },
        {
          file_name: transactionLogsFileName14DaysPrior,
          last_modified: Date.now() - 14 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName18DaysPrior,
          last_modified: Date.now() - 18 * 60 * 60 * 24 * 1000
        }
        ]);
        // This list method will be invoked after the deletion. The transaction logs which are not older than 14 days should remain.
        mocks.cloudProvider.listBlobs(serviceContainer, transactionLogsPrefix, [{
          file_name: transactionLogsFileName14DaysPrior,
          last_modified: Date.now() - 14 * 60 * 60 * 24 * 1000
        },
        {
          file_name: transactionLogsFileName1Daysprior,
          last_modified: Date.now() - 1 * 60 * 60 * 24 * 1000
        }
        ]);
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.download(pathname16, scheduled_data16);
        mocks.cloudProvider.download(pathname18, ondemand_data);
        mocks.serviceFabrikClient.deleteBackup(backup_guid2, space_guid, true);
        mocks.serviceFabrikClient.deleteBackup(backup_guid16, space_guid, true);
        mocks.cloudProvider.remove(transactionLogsPathname19);
        mocks.cloudProvider.remove(transactionLogsPathname16);
        mocks.cloudProvider.remove(transactionLogsPathname18);
        mocks.cloudProvider.list(container, prefix, [
          fileName1Daysprior
        ]);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const expectedJobResponse = {
            start_backup_status: 'instance_deleted',
            delete_backup_status: {
              deleted_guids: [backup_guid16, backup_guid2],
              deleted_transaction_log_files_count: 3,
              job_cancelled: false,
              instance_deleted: true
            }
          };
          // expect(baseJobLogRunHistoryStub).to.be.calledTwice;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedJobResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it('should cancel backup job (itself) when there are no more backups or transaction-logs to delete & instance is deleted', function () {
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, instance_id, {}, 1, 404);
        mocks.cloudProvider.list(container, prefix, []);
        mocks.cloudProvider.list(container, prefix, []);
        // Since, all the backups are deleted the list is returning empty.
        mocks.cloudProvider.listBlobs(serviceContainer, transactionLogsPrefix, [], 2);
        return ScheduleBackupJob.run(job, () => {}).then(() => {
          mocks.verify();
          const expectedJobResponse = {
            start_backup_status: 'instance_deleted',
            delete_backup_status: {
              deleted_guids: [],
              deleted_transaction_log_files_count: 0,
              job_cancelled: true,
              instance_deleted: true
            }
          };
          expect(cancelScheduleStub).to.be.calledOnce;
          expect(cancelScheduleStub.firstCall.args[0]).to.eql(instance_id);
          expect(cancelScheduleStub.firstCall.args[1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.eql(expectedJobResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it('should handle errors when cancelling backup job (itself)', function () {
        job.attrs.data.instance_id = failed_instance_id;
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DIRECTOR, failed_instance_id, {}, 1, 404);
        mocks.cloudProvider.list(container, failed_prefix, []);
        mocks.cloudProvider.list(container, failed_prefix, []);
        mocks.cloudProvider.listBlobs(serviceContainer, transactionLogsPrefixFailedInstance, [], 2);
        return ScheduleBackupJob.run(job, () => {}).then(() => {
          mocks.verify();
          const expectedJobResponse = {
            start_backup_status: 'instance_deleted',
            delete_backup_status: {
              deleted_guids: [],
              deleted_transaction_log_files_count: 0,
              job_cancelled: false,
              instance_deleted: true
            }
          };
          expect(cancelScheduleStub).to.be.calledOnce;
          expect(cancelScheduleStub.firstCall.args[0]).to.eql(failed_instance_id);
          expect(cancelScheduleStub.firstCall.args[1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.eql(expectedJobResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it('should log error in case instance Id and backup type is absent in Job data', function (done) {
        let sfClientStub;
        sfClientStub = sinon.stub(ScheduleBackupJob, 'getFabrikClient');
        job.attrs.data = {};
        return ScheduleBackupJob.run(job, () => {
          const invalidInputMsg = `Scheduled backup cannot be initiated as the required mandatory params (intance_uid | type) is empty : ${JSON.stringify(job.attrs.data)}`;
          expect(sfClientStub).not.to.be.called;
          sfClientStub.restore();
          expect(baseJobLogRunHistoryStub.firstCall.args[0].message).to.eql(invalidInputMsg);
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('BadRequest');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].reason).to.eql('Bad Request');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(400);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
          done();
        }).catch(done);
      });
      it('Should handle errors even while registering job failure and job must exit gracefully thereby releasing the lock', function () {
        saveJobFailure = true;
        mocks.serviceFabrikClient.startBackup(instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, {
          status: 500
        });
        return ScheduleBackupJob.run(job, () => {
          expect(baseJobLogRunHistoryStub).not.to.be.called;
        });
      });
    });
  });
});
