'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../logger');
const config = require('../config');
const CONST = require('../constants');
const moment = require('moment');
const BaseJob = require('./BaseJob');
const errors = require('../errors');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const cloudController = require('../cf').cloudController;
const backupStore = require('../iaas').backupStore;
const ScheduleManager = require('./ScheduleManager');

class BackupReaperJob extends BaseJob {

  static run(job, done) {
    job.__started_At = new Date();
    logger.info(`-> Starting BackupReaperJob - name: ${job.attrs.name}`);
    return this
      .deleteOldBackup(job)
      .then((deleteResponse) => this.runSucceeded(deleteResponse, job, done))
      .catch(err => {
        logger.error(`Error occurred during BackupReaperJob start. More info:  `, err);
        this.runFailed(
          _.set(err, 'statusCode', `ERR_FABRIK_BACKUP_REAPER_FAILED_${_.get(err, 'statusCode', _.get(err, 'status', ''))}`), {}, job, done);
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

  static deleteOldBackup(job) {
    const backupStartedBefore = moment().subtract(config.backup.retention_period_in_days + 1, 'days').toISOString();
    let numberOfBackups = 0;
    return backupStore
      .listBackupFilenames(backupStartedBefore)
      .map(fileNameObject => {
        ++numberOfBackups;
        logger.debug('Backup File info : ', fileNameObject);
        //on-demand backups must be deleted after instance deletion.
        const logInfo = `Backup guid : ${fileNameObject.backup_guid} - backedup on : ${fileNameObject.started_at}`;
        const deleteOptions = {
          backup_guid: fileNameObject.backup_guid,
          space_guid: fileNameObject.space_guid,
          force: true,
          user: {
            name: config.cf.username,
          }
        };
        const scheduledBackupOrInstanceDeleted = (data) => {
          return Promise.try(() => {
            if (data.trigger !== CONST.BACKUP.TRIGGER.SCHEDULED) {
              //it an on-demand backup
              //for optimization we are first checking whether for service insatnce_guid
              //scheduled backup job is there. if present it will take care of on-demand
              //backup deletion. if not will check with CF 
              return ScheduleManager
                .getSchedule(data.instance_guid, CONST.JOB.SCHEDULED_BACKUP)
                .then((jobData) => {
                  logger.debug('jobData of service instance scheduled backup: ', jobData);
                  return false;
                })
                .catch(errors.NotFound, () => this.isServiceInstanceDeleted(data.instance_guid));
            } else {
              return true;
            }
          });
        };
        logger.info(`-> Initiating delete of - ${logInfo}`);
        //Adding a delay for delete requests as we dont want to overload the undelying infra with too many deletes at the same second
        return Promise
          .delay(job.attrs.data.delete_delay * numberOfBackups)
          .then(() => {
            if (numberOfBackups % 30 === 0) {
              //Incase of many stale backups, once every 30 seconds touch the job which keeps the lock on the job
              job.touch(() => {});
            }
            return backupStore
              .deleteBackupFile(deleteOptions, scheduledBackupOrInstanceDeleted)
              .then((response) => {
                if (response && response === CONST.ERR_CODES.PRE_CONDITION_NOT_MET) {
                  logger.info(`${fileNameObject.backup_guid} - Backup not deleted as precondition not met`);
                  return;
                }
                logger.info(`Successfully deleted backup guid : ${fileNameObject.backup_guid}`);
                return fileNameObject.backup_guid;
              });
          });
      }).then(deletedBackupGuids => {
        logger.info(`Successfully deleted backup guids : ${deletedBackupGuids}`);
        const deleteResponse = {
          deleted_guids: deletedBackupGuids
        };
        return deleteResponse;
      });
  }
}

module.exports = BackupReaperJob;