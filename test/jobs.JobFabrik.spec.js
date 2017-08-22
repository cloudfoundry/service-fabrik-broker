'use strict';

const JobFabrik = require('../lib/jobs/JobFabrik');
const ScheduledBackup = require('../lib/jobs/ScheduleBackupJob');
const ScheduledOobDeploymentBackupJob = require('../lib/jobs/ScheduledOobDeploymentBackupJob');
const OperationStatusPollerJob = require('../lib/jobs/OperationStatusPollerJob');
const BluePrintJob = require('../lib/jobs/BluePrintJob');
const BackupReaperJob = require('../lib/jobs/BackupReaperJob');
const ServiceInstanceUpdateJob = require('../lib/jobs/ServiceInstanceUpdateJob');

const CONST = require('../lib/constants');
const AssertionError = require('assert').AssertionError;

describe('Jobs', function () {
  describe('JobFabrik', function () {
    describe('#getJob', function () {
      it('should return the requested Job Definition', function () {
        const backupJob = JobFabrik.getJob(CONST.JOB.SCHEDULED_BACKUP);
        expect(backupJob).to.eql(ScheduledBackup);
        const reaperJob = JobFabrik.getJob(CONST.JOB.BAKUP_REAPER);
        expect(reaperJob).to.eql(BackupReaperJob);
        const statusPollerJob = JobFabrik.getJob(CONST.JOB.OPERATION_STATUS_POLLER);
        expect(statusPollerJob).to.eql(OperationStatusPollerJob);
        const oobJob = JobFabrik.getJob(CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP);
        expect(oobJob).to.eql(ScheduledOobDeploymentBackupJob);
        const serviceInstanceUpdateJob = JobFabrik.getJob(CONST.JOB.SERVICE_INSTANCE_UPDATE);
        expect(serviceInstanceUpdateJob).to.eql(ServiceInstanceUpdateJob);
        const blueprintJob = JobFabrik.getJob(CONST.JOB.BLUEPRINT_JOB);
        expect(blueprintJob).to.eql(BluePrintJob);
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