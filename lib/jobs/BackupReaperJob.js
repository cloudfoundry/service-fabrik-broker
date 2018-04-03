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
const NotFound = errors.NotFound;
const cloudController = require('../cf').cloudController;
const backupStoreForInstance = require('../iaas').backupStore;
const backupStoreForOob = require('../iaas').backupStoreForOob;
const ScheduleManager = require('./ScheduleManager');
const EventLogInterceptor = require('../EventLogInterceptor');
const bosh = require('../bosh');

class BackupReaperJob extends BaseJob {

  static run(job, done) {
    job.__started_At = new Date();
    logger.info(`-> Starting BackupReaperJob - name: ${job.attrs.data[CONST.JOB_NAME_ATTRIB]}}`);
    return Promise
      .try(() => {
        // This block would be responsible for deleting old backups
        // 1. Deleting Backups for Service Instances
        // 2. Deleting Backups for OOB Deployments
        let guidsOfInstance = [];
        let guidsOfDeployments = [];
        return this.deleteOldBackup(job, {
            backupStore: backupStoreForInstance,
            isOob: false
          })
          .tap(deletedGuidsOfInstance => guidsOfInstance = deletedGuidsOfInstance)
          .then(() => this.deleteOldBackup(job, {
            backupStore: backupStoreForOob,
            isOob: true
          }))
          .tap(deletedGuidsOfDeployments => guidsOfDeployments = deletedGuidsOfDeployments)
          .then(() => _.concat(guidsOfInstance, guidsOfDeployments))
          .then(deletedBackupGuids => {
            logger.info(`Successfully deleted backup guids : ${deletedBackupGuids}`);
            const deleteResponse = {
              deleted_guids: deletedBackupGuids
            };
            return deleteResponse;
          });
      })
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

  static isDeploymentDeleted(deploymentName) {
    const director = bosh.director;
    return director.getDeployment(deploymentName)
      .then(() => false)
      .catch(NotFound, () => {
        logger.warn(`Deployment : ${deploymentName} not found`);
        return true;
      });
  }

  static deleteOldBackup(job, options) {
    const backupStartedBefore = moment().subtract(config.backup.retention_period_in_days + 1, 'days').toISOString();
    let numberOfBackups = 0;
    const eventLogger = EventLogInterceptor.getInstance(config.external.event_type, 'external');
    const backupStore = options.backupStore;
    const isOob = options.isOob;
    let listOptions;
    if (isOob === true) {
      listOptions = {
        root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
      };
    }

    // 'deleteBackup' is an inner function to delete each backup
    function deleteBackup(fileNameObject, deleteOptions) {
      ++numberOfBackups;
      logger.debug('Backup File info : ', fileNameObject);
      //on-demand backups must be deleted after instance / OOB deployment deletion.
      const logInfo = `Backup guid : ${fileNameObject.backup_guid} - backedup on : ${fileNameObject.started_at}`;
      deleteOptions = _.assign({
        backup_guid: fileNameObject.backup_guid,
        force: true,
        user: {
          name: config.cf.username,
        }
      }, deleteOptions);
      const scheduledBackupOrServiceDeleted = (data) => {
        return Promise.try(() => {
          if (data.trigger !== CONST.BACKUP.TRIGGER.SCHEDULED) {
            //it is an on-demand backup
            //for optimization we are first checking whether for service insatnce_guid or deployment
            //scheduled backup job is there. if present it will take care of on-demand
            //backup deletion. if not will check with CF or BOSH respectively
            return ScheduleManager
              .getSchedule(data.instance_guid || data.deployment_name,
                data.instance_guid ? CONST.JOB.SCHEDULED_BACKUP : CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP)
              .then((jobData) => {
                logger.debug('jobData of service instance or deployment scheduled backup: ', jobData);
                return false;
              })
              .catch(NotFound,
                () => {
                  logger.info(`Schedule not found for service instance or deployment ${data.instance_guid || data.deployment_name}`);
                  return data.instance_guid ? BackupReaperJob.isServiceInstanceDeleted(data.instance_guid) :
                    BackupReaperJob.isDeploymentDeleted(data.deployment_name);
                }
              );
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
          return Promise
            .try(() => {
              return backupStore.deleteBackupFile(deleteOptions, scheduledBackupOrServiceDeleted);
            })
            .then((response) => {
              if (response && response === CONST.ERR_CODES.PRE_CONDITION_NOT_MET) {
                logger.info(`${fileNameObject.backup_guid} - Backup not deleted as precondition not met`);
                return;
              }
              const resp = {
                statusCode: 200
              };
              const check_res_body = false;
              eventLogger.publishAndAuditLogEvent(CONST.URL.backup_by_guid, CONST.HTTP_METHOD.DELETE, deleteOptions, resp, check_res_body);
              logger.info(`Successfully deleted backup guid : ${fileNameObject.backup_guid}`);
              return fileNameObject.backup_guid;
            })
            .catch(err => logger.error(`Error occurred while deleting backup guid: ${fileNameObject.backup_guid}. More info: `, err));
        });
    }

    return Promise
      .try(() => backupStore.listBackupFilenames(backupStartedBefore, listOptions))
      .then((fileNames) =>
        Promise.map(fileNames, fileNameObject => {
          // Processing individual files after listing
          return Promise
            .try(() => isOob === true ? backupStore.getBackupFile(fileNameObject) : undefined)
            .then(backupData => {
              let deleteOptions = {};
              if (isOob === true) {
                //Processing for 'OOB deployment' backup
                if (backupData.container) {
                  deleteOptions = _.assign(listOptions, {
                    container: backupData.container
                  });
                } else {
                  /* Cotainer name not present in backupData
                   * Not deleting the backup, would be taken care by
                   * ScheduleOobBackupJob itself. This is to address
                   * some older backups, didn't set 'container' in metadata
                   */
                  return Promise.resolve();
                }
              } else { //isOob === false
                //Processing for 'Service Instance' backups
                deleteOptions = {
                  tenant_id: fileNameObject.tenant_id
                };
              }
              //Deleting each backups
              return deleteBackup(fileNameObject, deleteOptions);
            });
        }));
  }
}

module.exports = BackupReaperJob;