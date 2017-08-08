'use strict';

const assert = require('assert');
let ScheduleBackupJob;
let ServiceFabrikBackupJob;
let ScheduledOobDeploymentBackupJob;
let OperationStatusPollerJob;
let BackupReaperJob;
let bluePrintJob;
const CONST = require('../constants');

class JobFabrik {
  static getJob(jobType) {
    switch (jobType) {
    case CONST.JOB.SCHEDULED_BACKUP:
      if (ScheduleBackupJob === undefined) {
        ScheduleBackupJob = require('./ScheduleBackupJob');
      }
      return ScheduleBackupJob;
    case CONST.JOB.SERVICE_FABRIK_BACKUP:
      if (ServiceFabrikBackupJob === undefined) {
        ServiceFabrikBackupJob = require('./ServiceFabrikBackupJob');
      }
      return ServiceFabrikBackupJob;
    case CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP:
      if (ScheduledOobDeploymentBackupJob === undefined) {
        ScheduledOobDeploymentBackupJob = require('./ScheduledOobDeploymentBackupJob');
      }
      return ScheduledOobDeploymentBackupJob;
    case CONST.JOB.OPERATION_STATUS_POLLER:
      if (OperationStatusPollerJob === undefined) {
        OperationStatusPollerJob = require('./OperationStatusPollerJob');
      }
      return OperationStatusPollerJob;
    case CONST.JOB.BLUEPRINT_JOB:
      if (bluePrintJob === undefined) {
        bluePrintJob = require('./BluePrintJob');
      }
      return bluePrintJob;
    case CONST.JOB.BAKUP_REAPER:
      if (BackupReaperJob === undefined) {
        BackupReaperJob = require('./BackupReaperJob');
      }
      return BackupReaperJob;
    default:
      assert.fail(jobType, [CONST.JOB.SCHEDULED_BACKUP, CONST.JOB.SERVICE_FABRIK_BACKUP, CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP, CONST.JOB.OPERATION_STATUS_POLLER, CONST.JOB.BAKUP_REAPER], `Invalid job type. ${jobType} does not exist`, 'in');
    }
  }
}

module.exports = JobFabrik;