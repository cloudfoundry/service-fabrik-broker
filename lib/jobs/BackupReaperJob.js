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
    return this
      .deleteOldBackup(job)
      .then((deleteResponse) => this.runSucceeded(deleteResponse, job, done))
      .catch(err => {
        logger.error(`Error occurred during BackupReaperJob start. More info:  `, err);
        this.runFailed(
          _.set(err, 'statusCode', `ERR_FABRIK_BACKUP_REAPER_FAILED_${_.get(err, 'statusCode', _.get(err, 'status', ''))}`), {}, job, done);
      });
  }

  static deleteOldBackup(job) {
    const backupStartedBefore = moment().subtract(config.backup.retention_period_in_days + 1, 'days').toISOString();
    var numberOfBackups = 0;
    const eventLogger = EventLogInterceptor.getInstance(config.external.event_type, 'external');

    function isServiceInstanceDeleted(instanceId) {
      return cloudController.findServicePlanByInstanceId(instanceId)
        .then(() => false)
        .catch(ServiceInstanceNotFound, () => {
          logger.warn(`service instance : ${instanceId} deleted`);
          return true;
        });
    }

    function isDeploymentDeleted(deploymentName) {
      const director = bosh.director;
      return director.getDeployment(deploymentName)
        .then(() => false)
        .catch(NotFound, () => {
          logger.warn(`Deployment : ${deploymentName} not found`);
          return true;
        });
    }

    // 'deleteEachBackup' is an inner function to delete each backup
    function deleteEachBackup(fileNameObject, deleteOptions, backupStore) {
      ++numberOfBackups;
      logger.debug('Backup File info : ', fileNameObject);
      //on-demand backups must be deleted after instance deletion.
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
                  logger.warn(`Schedule not found for service instance or deployment ${data.instance_guid || data.deployment_name}`);
                  return data.instance_guid ? isServiceInstanceDeleted(data.instance_guid) :
                    isDeploymentDeleted(data.deployment_name);
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
      .all([
        backupStoreForInstance.listBackupFilenames(backupStartedBefore),
        backupStoreForOob.listBackupFilenames(backupStartedBefore, {
          root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
        })
      ])
      .spread((filesForInstance, filesForDeployments) => {
        return Promise
          .all([
            Promise.map(filesForInstance,
              fileNameObject => deleteEachBackup(fileNameObject, {
                tenant_id: fileNameObject.tenant_id
              }, backupStoreForInstance)
            ),
            Promise.map(filesForDeployments,
              fileNameObject => {
                return Promise
                  .try(() => backupStoreForOob.getBackupFile(fileNameObject))
                  .then(data => data.container ?
                    deleteEachBackup(fileNameObject, {
                      container: data.container,
                      root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
                    }, backupStoreForOob) :
                    Promise.resolve()
                  );
              }
            )
          ])
          .spread((guidsOfInstance, guidsOfDeployments) => _.concat(guidsOfInstance, guidsOfDeployments));
      })
      .then(deletedBackupGuids => {
        logger.info(`Successfully deleted backup guids : ${deletedBackupGuids}`);
        const deleteResponse = {
          deleted_guids: deletedBackupGuids
        };
        return deleteResponse;
      });
  }
}

module.exports = BackupReaperJob;