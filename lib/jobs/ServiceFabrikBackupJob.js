'use strict';

const _ = require('lodash');
const moment = require('moment');
const logger = require('../logger');
const BaseJob = require('./BaseJob');
const CONST = require('../constants');
const config = require('../config');
const backupStore = require('../iaas').backupStore;

const FABRIK_GUIDS = {
  service_id: CONST.FABRIK_INTERNAL_MONGO_DB.SERVICE_ID,
  plan_id: CONST.FABRIK_INTERNAL_MONGO_DB.PLAN_ID,
  space_guid: CONST.FABRIK_INTERNAL_MONGO_DB.SPACE_ID,
  instance_guid: CONST.FABRIK_INTERNAL_MONGO_DB.INSTANCE_ID
};

class ServiceFabrikBackupJob extends BaseJob {
  constructor() {
    super();
  }

  static run(job, done) {
    job.__started_At = new Date();
    let backupResp;
    logger.info('Starting ServiceFabrikBackupJob ...');
    return this
      .getBrokerClient()
      .startServiceFabrikBackup()
      .then(response => {
        //Only on successful initiation of backup, delete the older backup
        backupResp = response;
        return this.deleteOldBackup(job, false);
      })
      .then((deletedGuids) => this.checkBackupCompletionStatus(backupResp, deletedGuids, job, done))
      .catch(err => {
        logger.error('error occurred during service fabrik backup start. More info:  ', err);
        this.runFailed(
          _.set(err, 'statusCode', `ERR_FABRIK_BACKUP_INIT_FAILED_${_.get(err, 'statusCode', _.get(err, 'status', ''))}`), {}, job, done);
      });
  }

  static deleteOldBackup() {
    const backupStartedBefore = moment().subtract(config.backup.retention_period_in_days, 'days').toISOString();
    return backupStore
      .listBackupFilenames(backupStartedBefore, FABRIK_GUIDS)
      .map(fileNameObject => {
        logger.debug('ServiceFabrik Backup File info : ', fileNameObject);
        const logInfo = `ServiceFabrik backup guid : ${fileNameObject.backup_guid} - backedup on : ${fileNameObject.started_at}`;
        logger.info(`-> Initiating delete of - ${logInfo}`);
        const deleteOptions = _.assign({
          backup_guid: fileNameObject.backup_guid,
          container: config.mongodb.agent.provider.container,
          user: {
            name: config.cf.username
          }
        }, FABRIK_GUIDS);
        return backupStore
          .deleteBackupFile(deleteOptions)
          .then(() => {
            logger.info(`Successfully deleted service fabrik backup guid : ${fileNameObject.backup_guid}`);
            return fileNameObject.backup_guid;
          });
      });
  }

  static checkBackupCompletionStatus(backupResp, deletedGuids, job, done) {
    function isFinished(state) {
      return _.includes(['succeeded', 'failed', 'aborted'], state);
    }
    logger.debug('Checking backup status for backup started at : ', job.__started_At);
    const startedAt = moment(job.__started_At);
    const backupStatusChecker = () => {
      logger.debug('Checking backup status at : ', new Date());
      job.touch(() => {});
      //Reset the lock as status check could be long running
      try {
        this
          .getBrokerClient()
          .getServiceFabrikBackupStatus(backupResp.token)
          .then(response => {
            if (isFinished(response.state)) {
              logger.info('ServiceFabrik backup completed -', response);
              clearInterval(timer);
              if (response.state === 'succeeded') {
                backupResp.status = response;
                backupResp.deleted_guids = deletedGuids || 'none';
                this.runSucceeded(backupResp, job, done);
              } else {
                const msg = `Service Fabrik backup ${response.state}`;
                logger.error(msg);
                const err = {
                  statusCode: `ERR_FABRIK_BACKUP_${response.state}`,
                  statusMessage: msg
                };
                this.runFailed(err, {}, job, done);
              }
            } else {
              logger.info('ServiceFabrik backup still in-progress - ', response);
              const currTime = moment();
              if (currTime.diff(startedAt) > config.mongodb.backup.backup_timeout_time) {
                clearInterval(timer);
                const msg = `Service Fabrik backup exceeding timeout time ${config.mongodb.backup.backup_timeout_time/1000/60} (mins). Stopping status check`;
                logger.error(msg);
                const err = {
                  statusCode: 'ERR_BACKUP_TIME_OUT',
                  statusMessage: msg
                };
                this.runFailed(err, {}, job, done);
              }
            }
          });
      } catch (err) {
        clearInterval(timer);
        logger.error('Error occurred while checking service fabrik backup status. More info:', err);
        this.runFailed(err, {}, job, done);
      }
    };
    const timer = setInterval(backupStatusChecker,
      config.mongodb.backup.status_check_every);
    logger.debug(`Setting up backupstatus checker to run every : ${config.mongodb.backup.status_check_every/1000} seconds`);
    backupStatusChecker();
  }
}

module.exports = ServiceFabrikBackupJob;