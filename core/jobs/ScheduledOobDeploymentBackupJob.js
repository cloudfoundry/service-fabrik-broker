'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../common/logger');
const config = require('../common/config');
const moment = require('moment');
const BaseJob = require('./BaseJob');
const CONST = require('../common/constants');
const errors = require('../common/errors');
const NotFound = errors.NotFound;
const backupStore = require('../data-access-layer/iaas').backupStoreForOob;
const bosh = require('../data-access-layer/bosh');
const ScheduleManager = require('./ScheduleManager');

class ScheduledOobDeploymentBackupJob extends BaseJob {
  constructor() {
    super();
  }

  static run(job, done) {
    job.__started_At = new Date();
    const options = job.attrs.data;
    logger.info(`-> Starting ScheduledOobDeploymentBackupJob -  name: ${job.attrs.data[CONST.JOB_NAME_ATTRIB]} - with options: ${JSON.stringify(options)} `);
    if (!_.get(options, 'deployment_name') || !_.get(options, 'type')) {
      const msg = `Scheduled deployment backup cannot be initiated as the required mandatory params 
      (deployment_name | type) is empty : ${JSON.stringify(options)}`;
      logger.error(msg);
      this.runFailed(new errors.BadRequest(msg), {}, job, done);
      return;
    }

    const backupRunStatus = {
      start_backup_status: 'failed',
      delete_backup_status: 'failed'
    };
    let deploymentDeleted = false;
    return this
      .isDeploymentDeleted(options.deployment_name, options.bosh_director)
      .tap(deleteStatus => deploymentDeleted = deleteStatus)
      .then(() => {
        if (deploymentDeleted) {
          return 'deployment_deleted';
        }
        return this
          .getBrokerClient()
          .startDeploymentBackup(_.pick(options, 'deployment_name', 'type', 'trigger', 'bosh_director', 'container'));
      })
      .tap(backupResponse => backupRunStatus.start_backup_status = backupResponse)
      .then(() => this.deleteOldBackup(job, deploymentDeleted))
      .tap(deleteResponse => backupRunStatus.delete_backup_status = deleteResponse)
      .then(() => this.runSucceeded(backupRunStatus, job, done))
      .catch(err => {
        logger.error(`Error occurred during deployment ${_.get(options, 'deployment_name')} backup start. More info:  `, err);
        this.runFailed(
          _.set(err, 'statusCode', `ERR_FABRIK_BACKUP_INIT_FAILED_${_.get(err, 'statusCode', _.get(err, 'status', ''))}`), backupRunStatus, job, done);
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
  static deleteOldBackup(job, deploymentDeleted) {
    const backupStartedBefore = moment().subtract(config.backup.retention_period_in_days, 'days').toISOString();
    const deploymentName = job.attrs.data.deployment_name;
    const options = {
      deployment_name: deploymentName,
      root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME
    };
    let numberOfBackups = 0;
    return backupStore
      .listBackupFilenames(backupStartedBefore, options)
      .map(fileNameObject => {
        ++numberOfBackups;
        logger.debug(`${deploymentName} Backup File info : `, fileNameObject);
        const logInfo = `${deploymentName} backup guid : ${fileNameObject.backup_guid} - backedup on : ${fileNameObject.started_at}`;
        logger.info(`-> Initiating delete of - ${logInfo}`);
        const deleteOptions = {
          backup_guid: fileNameObject.backup_guid,
          container: job.attrs.data.container,
          root_folder: CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME,
          user: {
            name: config.cf.username
          },
          force: true
        };
        // Adding a delay for delete requests as we dont want to overload the undelying infra with too many deletes at the same second
        // Default delay added to take care of existing scheduled Jobs.
        return Promise
          .delay((job.attrs.data.delete_delay || CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.DEFAULT_DELETE_DELAY) * numberOfBackups)
          .then(() => {
            if (numberOfBackups % 30 === 0) {
              // Incase of many stale backups, once every 30 seconds touch the job which keeps the lock on the job
              job.touch(() => {});
            }
            return backupStore
              .deleteBackupFile(deleteOptions)
              .then(() => {
                logger.info(`Successfully deleted deployment ${deploymentName} backup guid : ${fileNameObject.backup_guid}`);
                return fileNameObject.backup_guid;
              });
          });
      }).then(deletedBackupGuids => {
        logger.info(`Successfully deleted backup guids, deployment deletion status : ${deploymentDeleted}`);
        const deleteResponse = {
          deleted_guids: deletedBackupGuids,
          job_cancelled: false,
          deployment_deleted: deploymentDeleted
        };
        if (!deploymentDeleted) {
          return deleteResponse;
        }
        logger.info(`Deployment deleted. Checking if there are any more backups for :${options.deployment_name}`);
        const backupStartedBefore = new Date().toISOString();
        return backupStore
          .listBackupFilenames(backupStartedBefore, options)
          .then(listOfFiles => {
            if (listOfFiles.length === 0) {
              // Deployment is deleted and no more backups present. Cancel the backup scheduler for the deployment
              logger.info(`-> No more backups for the deleted deployment : ${options.deployment_name}. Cancelling backup scheduled Job`);
              return ScheduleManager
                .cancelSchedule(options.deployment_name, CONST.JOB.SCHEDULED_OOB_DEPLOYMENT_BACKUP)
                .catch(err => {
                  logger.error(`Error occurred while cancelling schedule for : ${job.attrs.data[CONST.JOB_NAME_ATTRIB]}`, err);
                })
                .then(() => {
                  deleteResponse.job_cancelled = true;
                  logger.info(`Job : ${job.attrs.data[CONST.JOB_NAME_ATTRIB]} is cancelled`);
                  return deleteResponse;
                })
                .finally(() => {
                  return deleteResponse;
                });
            } else {
              logger.info(`Schedule Job for deployment  ${options.deployment_name} cannot be cancelled yet as ${listOfFiles.length} backup(s) exist`);
              return deleteResponse;
            }
          });
      });
  }
}

module.exports = ScheduledOobDeploymentBackupJob;
