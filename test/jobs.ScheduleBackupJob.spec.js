'use strict';

const _ = require('lodash');
const CONST = require('../broker/lib/constants');
const config = require('../broker/lib/config');
const moment = require('moment');
const Promise = require('bluebird');
const lib = require('../broker/lib');
const errors = lib.errors;
const ScheduleManager = require('../broker/lib/jobs/ScheduleManager');
const JobFabrik = require('../broker/lib/jobs/JobFabrik');
const BaseJob = require('../broker/lib/jobs/BaseJob');
const backupStore = lib.iaas.backupStore;
const filename = lib.iaas.backupStore.filename;

describe('Jobs', function () {
  /* jshint expr:true */

  describe('ScheduleBackupJob', function () {
    const ScheduleBackupJob = JobFabrik.getJob(CONST.JOB.SCHEDULED_BACKUP);

    describe('#RunBackup', function () {
      const index = mocks.director.networkSegmentIndex;
      const instance_id = mocks.director.uuidByIndex(index);
      const failed_instance_id = mocks.director.uuidByIndex(22);
      const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
      const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
      const backup_guid = '071acb05-66a3-471b-af3c-8bbf1e4180be';
      const backup_guid2 = '081acb05-66a3-471b-af3c-8bbf1e4180bf';
      const backup_guid3 = '091acb05-66a3-471b-af3c-8bbf1e4180bg';
      const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
      const container = backupStore.containerName;
      const started1DaysPrior = filename.isoDate(moment().subtract(1, 'days').toISOString());
      const started18DaysPrior = filename.isoDate(moment()
        .subtract(config.backup.retention_period_in_days + 4, 'days').toISOString());
      const started14DaysPrior = filename.isoDate(moment()
        .subtract(config.backup.retention_period_in_days + 1, 'days').toISOString());
      const prefix = `${space_guid}/backup/${service_id}.${instance_id}`;
      const failed_prefix = `${space_guid}/backup/${service_id}.${failed_instance_id}`;
      const fileName1Daysprior = `${prefix}.${backup_guid3}.${started1DaysPrior}.json`;
      const fileName14Daysprior = `${prefix}.${backup_guid}.${started14DaysPrior}.json`;
      const fileName18DaysPrior = `${prefix}.${backup_guid2}.${started18DaysPrior}.json`;
      const pathname14 = `/${container}/${fileName14Daysprior}`;
      const pathname18 = `/${container}/${fileName18DaysPrior}`;
      const scheduled_data = {
        trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
        type: 'online',
        state: 'succeeded',
        backup_guid: backup_guid,
        started_at: started14DaysPrior,
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
      let baseJobLogRunHistoryStub, cancelScheduleStub, runAtStub, delayStub;

      before(function () {
        backupStore.cloudProvider = new lib.iaas.CloudProviderClient(config.backup.provider);
        mocks.cloudProvider.auth();
        mocks.cloudProvider.getContainer(container);
        baseJobLogRunHistoryStub = sinon.stub(BaseJob, 'logRunHistory');
        baseJobLogRunHistoryStub.withArgs().returns(Promise.resolve({}));
        delayStub = sinon.stub(Promise, 'delay', () => Promise.resolve());
        cancelScheduleStub = sinon.stub(ScheduleManager, 'cancelSchedule');
        cancelScheduleStub.withArgs(failed_instance_id).returns(Promise.reject(new errors.ServiceUnavailable('Scheduler Unavailable')));
        cancelScheduleStub.returns(Promise.resolve({}));
        runAtStub = sinon.stub(ScheduleManager, 'runAt');
        runAtStub.withArgs(failed_instance_id).throws(new errors.ServiceUnavailable('Scheduler Unavailable'));
        runAtStub.returns(Promise.resolve({}));
        return mocks.setup([backupStore.cloudProvider.getContainer()]);
      });

      afterEach(function () {
        job.attrs.data.instance_id = instance_id;
        baseJobLogRunHistoryStub.reset();
        cancelScheduleStub.reset();
        runAtStub.reset();
        delayStub.reset();
        job.attrs.data.attempt = 1;
        saveJobFailure = false;
      });

      after(function () {
        baseJobLogRunHistoryStub.restore();
        cancelScheduleStub.restore();
        runAtStub.restore();
        delayStub.restore();
      });

      it('should initiate backup, delete scheduled backup older than 14 days & should not delete on-demand backup', function () {
        const backupResponse = {
          backup_guid: backup_guid
        };
        mocks.cloudController.findServicePlan(instance_id, plan_id);
        mocks.serviceFabrikClient.startBackup(instance_id, {
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED
        }, backupResponse);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior,
          fileName18DaysPrior,
          fileName1Daysprior
        ]);
        //Out of 3 files 1 day prior is filtered out & the 18 day prior on demand will not be deleted
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.download(pathname18, ondemand_data);
        mocks.serviceFabrikClient.deleteBackup(backup_guid, space_guid);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const expectedBackupResponse = {
            start_backup_status: {
              name: 'backup',
              guid: backupResponse.backup_guid
            },
            delete_backup_status: {
              deleted_guids: [undefined, '071acb05-66a3-471b-af3c-8bbf1e4180be'],
              job_cancelled: false,
              instance_deleted: false
            }
          };
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
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
        mocks.cloudController.findServicePlan(instance_id, plan_id);
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
        mocks.cloudController.findServicePlan(instance_id, plan_id);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const errStatusCode = 409;
          const backupRunStatus = {
            start_backup_status: 'failed',
            delete_backup_status: 'failed'
          };
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(runAtStub).to.be.calledOnce;
          expect(runAtStub.firstCall.args[0]).to.eql(instance_id);
          expect(runAtStub.firstCall.args[1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
          expect(runAtStub.firstCall.args[2]).to.eql(config.scheduler.jobs.reschedule_delay);
          const expectedJobData = _.clone(job.attrs.data);
          expectedJobData.attempt = 2;
          expect(runAtStub.firstCall.args[3]).to.eql(expectedJobData);
          expect(runAtStub.firstCall.args[4]).to.eql(CONST.SYSTEM_USER);
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('Conflict');
          expect(baseJobLogRunHistoryStub.firstCall.args[0].status).to.eql(errStatusCode);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(backupRunStatus);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
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
        mocks.cloudController.findServicePlan(failed_instance_id, plan_id);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const backupRunStatus = {
            start_backup_status: 'failed',
            delete_backup_status: 'failed'
          };
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(runAtStub.callCount).to.be.eql(3); //Retry mechanism to schedule runAt is 3 times on error
          expect(baseJobLogRunHistoryStub.firstCall.args[0].name).to.eql('Timeout');
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
        mocks.cloudController.findServicePlan(instance_id, plan_id);
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
        mocks.cloudController.findServicePlan(instance_id);
        mocks.cloudProvider.list(container, prefix, [
          fileName14Daysprior,
          fileName18DaysPrior,
          fileName1Daysprior
        ]);
        mocks.cloudProvider.download(pathname14, scheduled_data);
        mocks.cloudProvider.download(pathname18, ondemand_data);
        mocks.serviceFabrikClient.deleteBackup(backup_guid, space_guid);
        mocks.serviceFabrikClient.deleteBackup(backup_guid2, space_guid);
        mocks.cloudProvider.list(container, prefix, [
          fileName1Daysprior
        ]);
        return ScheduleBackupJob.run(job, () => {
          mocks.verify();
          const expectedJobResponse = {
            start_backup_status: 'instance_deleted',
            delete_backup_status: {
              deleted_guids: [backup_guid2, backup_guid],
              job_cancelled: false,
              instance_deleted: true
            }
          };
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.deep.equal(expectedJobResponse);
          expect(baseJobLogRunHistoryStub.firstCall.args[2].attrs).to.eql(job.attrs);
          expect(baseJobLogRunHistoryStub.firstCall.args[3]).to.eql(undefined);
        });
      });
      it('should cancel backup job (itself) when there are no more backups to delete & instance is deleted', function () {
        mocks.cloudController.findServicePlan(instance_id);
        mocks.cloudProvider.list(container, prefix, []);
        mocks.cloudProvider.list(container, prefix, []);
        return ScheduleBackupJob.run(job, () => {}).then(() => {
          mocks.verify();
          const expectedJobResponse = {
            start_backup_status: 'instance_deleted',
            delete_backup_status: {
              deleted_guids: [],
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
        mocks.cloudController.findServicePlan(failed_instance_id);
        mocks.cloudProvider.list(container, failed_prefix, []);
        mocks.cloudProvider.list(container, failed_prefix, []);
        return ScheduleBackupJob.run(job, () => {}).then(() => {
          mocks.verify();
          const expectedJobResponse = {
            start_backup_status: 'instance_deleted',
            delete_backup_status: {
              deleted_guids: [],
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
        mocks.cloudController.findServicePlan(instance_id, plan_id);
        return ScheduleBackupJob.run(job, () => {
          expect(baseJobLogRunHistoryStub).not.to.be.called;
        });
      });
    });
  });
});