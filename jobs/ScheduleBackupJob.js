'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../common/logger');
const config = require('../common/config');
const BaseJob = require('./BaseJob');
const CONST = require('../common/constants');
const errors = require('../common/errors');
const utils = require('../common/utils');
const retry = utils.retry;
const catalog = require('../common/models').catalog;
const eventmesh = require('../data-access-layer/eventmesh');
const backupStore = require('../data-access-layer/iaas').backupStore;
const ScheduleManager = require('./ScheduleManager');
//Above reference to schedulemanager leads to the below cyclic dependency:
// ScheduleManager -> Scheduler -> JobFabrik -> ScheduleBackupJob -> ScheduleManager
// However in JobFabrik the reference is done at runtime & hence the above reference back to ScheduleManager does
// not pose the typical issues of cyclic dependencies.

//Intentionally Jobs are kept as static as we register same definition for all Jobs of similar type
//Any instance specific references if reqiured for any jobs must be kept within run method for any future jobs
class ScheduleBackupJob extends BaseJob {

  static run(job, done) {
    return Promise.try(() => {
        job.__started_At = new Date();
        const jobData = job.attrs.data;
        logger.info(`-> Starting ScheduleBackupJob -  name: ${jobData[CONST.JOB_NAME_ATTRIB]} - with options: ${JSON.stringify(jobData)} `);
        if (!_.get(jobData, 'instance_id') || !_.get(jobData, 'type')) {
          const msg = `Scheduled backup cannot be initiated as the required mandatory params (intance_uid | type) is empty : ${JSON.stringify(jobData)}`;
          logger.error(msg);
          return this.runFailed(new errors.BadRequest(msg), undefined, job, done);
        }
        const backupRunStatus = {
          start_backup_status: 'failed',
          delete_backup_status: 'failed'
        };
        let instanceDeleted = false;
        return this
          .isServiceInstanceDeleted(jobData.instance_id)
          .tap(deleteStatus => instanceDeleted = deleteStatus)
          .then(() => {
            if (instanceDeleted) {
              if (!_.get(job.attrs.data, 'instance_deletion_time')) {
                job.attrs.data.instance_deletion_time = new Date(Date.now()).toISOString();
              }
              return 'instance_deleted';
            }
            return this
              .getFabrikClient()
              .startBackup(_.pick(jobData, 'instance_id', 'type', 'trigger'));
          })
          .tap(backupResponse => backupRunStatus.start_backup_status = backupResponse)
          .then(() => this.deleteOldBackup(job, instanceDeleted))
          .tap(deleteResponse => backupRunStatus.delete_backup_status = deleteResponse)
          .then(() => this.runSucceeded(backupRunStatus, job, done))
          .catch((error) => {
            return this.runFailed(error, backupRunStatus, job, done)
              .then(() => {
                if (error instanceof errors.Conflict || error instanceof errors.UnprocessableEntity) {
                  return retry(() => this.reScheduleBackup(job.attrs.data, job.attrs.repeatInterval), {
                    maxAttempts: 3,
                    minDelay: 500
                  });
                }
              });
          });
      })
      .catch(error => {
        logger.error(`Error occurred while handling failure for job :${job.attrs.data[CONST.JOB_NAME_ATTRIB]}`, error);
        done();
      });
  }

  static isServiceInstanceDeleted(instanceId) {
    return eventmesh.apiServerClient.getResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DIRECTOR,
        resourceId: instanceId
      })
      .then(resource => _.get(resource, 'metadata.deletionTimestamp') ? true : false)
      .catch(errors.NotFound, () => {
        logger.warn(`service instance : ${instanceId} deleted`);
        return true;
      });
  }

  static deleteOldBackup(job, instanceDeleted) {
    let transactionLogsBefore;

    function filterOldBackups(oldBackups) {
      let filteredOldBackups = [];
      /* oldBackups : This aray should contain all older backups
      // including last retenion day's backup. E.g. if retention period
      // is 15 days it would include all backups in (15th, 16th, 17th ...) */
      if (typeof oldBackups !== 'undefined' && oldBackups.length > 0) {
        // Older backups are sorted as latest at first
        let sortedBackups = _.sortBy(oldBackups, ['started_at']).reverse();
        let deleteAllOlderBackups = false;
        const latestSuccessIndex = _.findIndex(sortedBackups,
          backup => backup.state === CONST.OPERATION.SUCCEEDED);
        if (_.get(job.attrs.data, 'instance_deletion_time')) {
          const instanceDeletionTime = job.attrs.data.instance_deletion_time;
          const instanceDeletedBefore = (new Date(Date.now()) - new Date(instanceDeletionTime)) / (24 * 60 * 60 * 1000); //in days
          if (instanceDeletedBefore > config.backup.retention_period_in_days) {
            deleteAllOlderBackups = true;
          }
        }
        if (latestSuccessIndex === -1 || deleteAllOlderBackups) {
          //No successful backup beyond retention period.
          filteredOldBackups = sortedBackups;
          transactionLogsBefore = new Date(Date.now() - (config.backup.retention_period_in_days + 1) * 24 * 60 * 60 * 1000).toISOString();
        } else {
          //Should return backups before a successful backup.
          filteredOldBackups = _.slice(sortedBackups, latestSuccessIndex + 1);
          let backupStartedMillis = new Date(_.get(sortedBackups[latestSuccessIndex], 'started_at')).getTime();
          transactionLogsBefore = new Date(backupStartedMillis - config.backup.transaction_logs_delete_buffer_time * 60 * 1000).toISOString();
        }
      } else {
        transactionLogsBefore = new Date(Date.now() - (config.backup.retention_period_in_days + 1) * 24 * 60 * 60 * 1000).toISOString();
      }
      return filteredOldBackups;
    }

    const options = _.omit(job.attrs.data, 'trigger', 'type');
    const serviceName = catalog.getService(job.attrs.data.service_id).name;
    const listOptions = {
      instance_id: job.attrs.data.instance_id,
      service_name: serviceName
    };
    return backupStore
      .listBackupsOlderThan(options, config.backup.retention_period_in_days)
      .then(oldBackups => filterOldBackups(oldBackups))
      .map(backup => {
        //Deleting base backup/backup guids.
        logger.debug(`Backup meta info : ${JSON.stringify(backup)}`);
        if (backup.trigger === CONST.BACKUP.TRIGGER.SCHEDULED || instanceDeleted) {
          //on-demand backups must be deleted after instance deletion.
          const logInfo = `backup guid : ${backup.backup_guid} - instance : ${options.instance_id} - type : ${backup.type} - backedup on : ${backup.started_at}`;
          logger.info(`-> Initiating delete of - ${logInfo} - instance deleted : ${instanceDeleted}`);
          const deleteOptions = {
            backup_guid: backup.backup_guid,
            tenant_id: options.tenant_id,
            instance_deleted: instanceDeleted
          };
          return this
            .getFabrikClient()
            .deleteBackup(deleteOptions)
            .then(() => backup.backup_guid);
        }
      })
      .then(deletedBackupGuids => {
        // Deleting transaction logs from service-container.
        return backupStore.deleteTransactionLogsOlderThan(listOptions, transactionLogsBefore)
          .then(deletedTransactionLogFilesCount => {
            const deletedObjects = {
              deletedBackupGuids: deletedBackupGuids,
              deletedTransactionLogFilesCount: deletedTransactionLogFilesCount
            };
            return deletedObjects;
          });
      })
      .then(deletedObjects => {
        logger.info(`Successfully deleted backup guids : ${deletedObjects.deletedBackupGuids} - instance deleted : ${instanceDeleted}`);
        const deleteResponse = {
          deleted_guids: deletedObjects.deletedBackupGuids,
          job_cancelled: false,
          deleted_transaction_log_files_count: deletedObjects.deletedTransactionLogFilesCount,
          instance_deleted: instanceDeleted
        };
        if (!instanceDeleted) {
          return deleteResponse;
        }
        logger.info(`Instance deleted. Checking if there are any more backups for :${options.instance_id}`);
        const backupStartedBefore = new Date().toISOString();
        transactionLogsBefore = new Date().toISOString();
        return Promise.all([
            backupStore.listBackupFilenames(backupStartedBefore, options),
            backupStore.listTransactionLogsOlderThan(listOptions, transactionLogsBefore)
          ])
          .spread((listOfBackups, listOfTransactionLogs) => {
            if (listOfBackups.length === 0 && listOfTransactionLogs.length === 0) {
              //Instance is deleted and no more backups present. Cancel the backup scheduler for the instance
              logger.info(`-> No more backups for the deleted instance : ${options.instance_id}. Cancelling backup scheduled Job`);
              return ScheduleManager
                .cancelSchedule(options.instance_id, CONST.JOB.SCHEDULED_BACKUP)
                .then(() => {
                  deleteResponse.job_cancelled = true;
                  logger.info(`Job : ${job.attrs.data[CONST.JOB_NAME_ATTRIB]} is cancelled`);
                  return deleteResponse;
                })
                .catch(err => {
                  logger.error(`error occurred while cancelling schedule for : ${job.attrs.data[CONST.JOB_NAME_ATTRIB]}`, err);
                  return deleteResponse;
                });

            } else {
              logger.info(`Schedule Job for instance  ${options.instance_id} cannot be cancelled yet as ${listOfBackups.length} backup(s) exist`);
              return deleteResponse;
            }
          });
      });
  }


  static reScheduleBackup(jobOptions, repeatInterval) {
    return Promise.try(() => {
      const jobData = _.cloneDeep(jobOptions);
      jobData.attempt = jobData.attempt + 1;
      const MAX_ATTEMPTS = _.get(jobData, 'max_attempts', config.scheduler.jobs.scheduled_backup.max_attempts);
      if (jobData.attempt > MAX_ATTEMPTS) {
        logger.error(`Scheduled backup for instance  ${jobData.instance_id} has exceeded max configured attempts : ${MAX_ATTEMPTS} - ${jobData.attempt}}. Initial attempt was done @: ${jobData.firstAttemptAt}.`);
        // Resetting the number of attempts to 0 and re-creating the schedule with this modified param
        jobData.attempt = 0;
        return ScheduleManager.schedule(
            jobData.instance_id,
            CONST.JOB.SCHEDULED_BACKUP,
            repeatInterval,
            jobData,
            CONST.SYSTEM_USER)
          .then(() => {
            throw new errors.toManyAttempts(config.scheduler.jobs.scheduled_backup.max_attempts, new Error(`Failed to reschedule backup for ${jobData.instance_id}`));
          });
      }
      const RUN_AFTER = _.get(jobData, 'reschedule_delay', config.scheduler.jobs.reschedule_delay);
      let retryDelayInMinutes;
      logger.info(`Re-Schedulding Backup Job for ${jobData.instance_id} @ ${RUN_AFTER} - Attempt - ${jobData.attempt}. Initial attempt was done @: ${jobData.firstAttemptAt}`);
      if ((RUN_AFTER.toLowerCase()).indexOf('minutes') !== -1) {
        retryDelayInMinutes = parseInt(/^[0-9]+/.exec(RUN_AFTER)[0]);
      }
      const plan = catalog.getPlan(jobData.plan_id);
      let retryInterval = utils.getCronWithIntervalAndAfterXminute(plan.service.backup_interval || 'daily', retryDelayInMinutes);
      return ScheduleManager.schedule(
        jobData.instance_id,
        CONST.JOB.SCHEDULED_BACKUP,
        retryInterval,
        jobData,
        CONST.SYSTEM_USER);
    });
  }
}

module.exports = ScheduleBackupJob;