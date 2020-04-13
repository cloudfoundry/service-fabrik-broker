'use strict';

const JobFabrik = require('../../core/scheduler-jobs/src/jobs/JobFabrik');
const ScheduledBackup = require('../../core/scheduler-jobs/src/jobs/ScheduleBackupJob');
const ScheduledOobDeploymentBackupJob = require('../../core/scheduler-jobs/src/jobs/ScheduledOobDeploymentBackupJob');
const OperationStatusPollerJob = require('../../core/scheduler-jobs/src/jobs/OperationStatusPollerJob');
const BluePrintJob = require('../../core/scheduler-jobs/src/jobs/BluePrintJob');
const BackupReaperJob = require('../../core/scheduler-jobs/src/jobs/BackupReaperJob');
const ServiceInstanceUpdateJob = require('../../core/scheduler-jobs/src/jobs/ServiceInstanceUpdateJob');
const DbCollectionReaperJob = require('../../core/scheduler-jobs/src/jobs/DbCollectionReaperJob');
const MeterInstanceJob = require('../../core/scheduler-jobs/src/jobs/MeterInstanceJob');
const { CONST } = require('@sf/common-utils');
const AssertionError = require('assert').AssertionError;

describe('Jobs', function () {
  describe('JobFabrik', function () {
    describe('#getJob', function () {
      it('should return the requested Job Definition', function () {
        const backupJob = JobFabrik.getJob(CONST.JOB.SCHEDULED_BACKUP);
        expect(backupJob).to.eql(ScheduledBackup);
        const reaperJob = JobFabrik.getJob(CONST.JOB.BACKUP_REAPER);
        expect(reaperJob).to.eql(BackupReaperJob);
        const statusPollerJob = JobFabrik.getJob(CONST.JOB.OPERATION_STATUS_POLLER);
        expect(statusPollerJob).to.eql(OperationStatusPollerJob);
        const oobJob = JobFabrik.getJob(CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP);
        expect(oobJob).to.eql(ScheduledOobDeploymentBackupJob);
        const serviceInstanceUpdateJob = JobFabrik.getJob(CONST.JOB.SERVICE_INSTANCE_UPDATE);
        expect(serviceInstanceUpdateJob).to.eql(ServiceInstanceUpdateJob);
        const dbCollectionReaperJob = JobFabrik.getJob(CONST.JOB.DB_COLLECTION_REAPER);
        expect(dbCollectionReaperJob).to.eql(DbCollectionReaperJob);
        const blueprintJob = JobFabrik.getJob(CONST.JOB.BLUEPRINT_JOB);
        expect(blueprintJob).to.eql(BluePrintJob);
        const meterInstanceJob = JobFabrik.getJob(CONST.JOB.METER_INSTANCE);
        expect(meterInstanceJob).to.eql(MeterInstanceJob);
        blueprintJob.run({
          attrs: {
            data: {}
          }
        }, () => {});
      });
      it('should throw Assertion error when requested non-existing job definition', function () {
        expect(JobFabrik.getJob.bind(JobFabrik, 'NON_EXISTING_JOB')).to.throw(AssertionError);
      });
    });
  });
});
