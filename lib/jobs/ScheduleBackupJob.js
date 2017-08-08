'use strict';

const _ = require('lodash');
const logger = require('../logger');
const config = require('../config');
const BaseJob = require('./BaseJob');
const CONST = require('../constants');
const errors = require('../errors');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const cloudController = require('../cf').cloudController;
const backupStore = require('../iaas').backupStore;
const ScheduleManager = require('./ScheduleManager');
//Above reference to schedulemanager leads to the below cyclic dependency:
// ScheduleManager -> Scheduler -> JobFabrik -> ScheduleBackupJob -> ScheduleManager
// However in JobFabrik the reference is done at runtime & hence the above reference back to ScheduleManager does
// not pose the typical issues of cyclic dependencies.

//Intentionally Jobs are kept as static as we register same definition for all Jobs of similar type
//Any instance specific references if reqiured for any jobs must be kept within run method for any future jobs
class ScheduleBackupJob extends BaseJob {
  constructor() {
    super();
  }

  static run(job, done) {
    job.__started_At = new Date();
    const options = job.attrs.data;
    logger.info(`-> Starting ScheduleBackupJob -  name: ${job.attrs.name} - with options: ${JSON.stringify(options)} `);
    if (!_.get(options, 'instance_id') || !_.get(options, 'type')) {
      const msg = `Scheduled backup cannot be initiated as the required mandatory params (intance_uid | type) is empty : ${JSON.stringify(options)}`;
      logger.error(msg);
      this.runFailed(new errors.BadRequest(msg), {}, job, done);
      return;
    }
    const backupRunStatus = {
      start_backup_status: 'failed',
      delete_backup_status: 'failed'
    };
    let instanceDeleted = false;
    return this
      .isServiceInstanceDeleted(options.instance_id)
      .tap(deleteStatus => instanceDeleted = deleteStatus)
      .then(() => {
        if (instanceDeleted) {
          return 'instance_deleted';
        }
        return this
          .getFabrikClient()
          .startBackup(_.pick(options, 'instance_id', 'type', 'trigger'));
      })
      .tap(backupResponse => backupRunStatus.start_backup_status = backupResponse)
      .then(() => this.deleteOldBackup(job, instanceDeleted))
      .tap(deleteResponse => backupRunStatus.delete_backup_status = deleteResponse)
      .then(() => this.runSucceeded(backupRunStatus, job, done))
      .catch((error) => this.runFailed(error, backupRunStatus, job, done))
      .catch(error => {
        logger.error(`Error occurred while handling failure for job :${job.attrs.name}`, error);
        done();
      });
  }

  static isServiceInstanceDeleted(instanceId) {
    return cloudController.findServicePlanByInstanceId(instanceId)
      .then(() => false)
      .catch(ServiceInstanceNotFound, () => {
        logger.warn(`service instance : ${instanceId} deleted`);
        return true;
      });
  }

  static deleteOldBackup(job, instanceDeleted) {
    const options = _.omit(job.attrs.data, 'trigger', 'type');
    return backupStore
      .listBackupsOlderThan(options, config.backup.retention_period_in_days)
      .map(backup => {
        logger.debug(`Backup meta info : ${JSON.stringify(backup)}`);
        if (backup.trigger === CONST.BACKUP.TRIGGER.SCHEDULED || instanceDeleted) {
          //on-demand backups must be deleted after instance deletion.
          const logInfo = `backup guid : ${backup.backup_guid} - instance : ${options.instance_id} - type : ${backup.type} - backedup on : ${backup.started_at}`;
          logger.info(`-> Initiating delete of - ${logInfo} - instance deleted : ${instanceDeleted}`);
          const deleteOptions = {
            backup_guid: backup.backup_guid,
            space_guid: options.space_guid
          };
          return this
            .getFabrikClient()
            .deleteBackup(deleteOptions)
            .then(() => backup.backup_guid);
        }
      }).then(deletedBackupGuids => {
        logger.info(`Successfully deleted backup guids : ${deletedBackupGuids} - instance deleted : ${instanceDeleted}`);
        const deleteResponse = {
          deleted_guids: deletedBackupGuids,
          job_cancelled: false,
          instance_deleted: instanceDeleted
        };
        if (!instanceDeleted) {
          return deleteResponse;
        }
        logger.info(`Instance deleted. Checking if there are any more backups for :${options.instance_id}`);
        const backupStartedBefore = new Date().toISOString();
        return backupStore
          .listBackupFilenames(backupStartedBefore, options)
          .then(listOfFiles => {
            if (listOfFiles.length === 0) {
              //Instance is deleted and no more backups present. Cancel the backup scheduler for the instance
              logger.info(`-> No more backups for the deleted instance : ${options.instance_id}. Cancelling backup scheduled Job`);
              return ScheduleManager
                .cancelSchedule(options.instance_id, CONST.JOB.SCHEDULED_BACKUP)
                .catch(err => {
                  logger.error(`error occurred while cancelling schedule for : ${job.attrs.name}`, err);
                })
                .then(() => {
                  deleteResponse.job_cancelled = true;
                  logger.info(`Job : ${job.attrs.name} is cancelled`);
                  return deleteResponse;
                })
                .finally(() => {
                  return deleteResponse;
                });
            } else {
              logger.info(`Schedule Job for instance  ${options.instance_id} cannot be cancelled yet as ${listOfFiles.length} backup(s) exist`);
              return deleteResponse;
            }
          });
      });
  }
}

module.exports = ScheduleBackupJob;