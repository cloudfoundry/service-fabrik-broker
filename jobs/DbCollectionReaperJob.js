'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const logger = require('../common/logger');
const moment = require('moment');
const BaseJob = require('./BaseJob');
const ScheduleManager = require('./ScheduleManager');
const Repository = require('../common/db').Repository;

class DbCollectionReaperJob extends BaseJob {
  static run(job, done) {
    logger.info('-> Starting DbCollectionReaperJob');
    const collectionListToReap = _.get(job, 'attrs.data.reap_collections', []);
    let deleteResponse = [];
    return Promise.map(collectionListToReap, (collectionConfig) => {
        const retentionPeriod = _.get(collectionConfig, 'retention_in_days', 0);
        logger.info(`Retention period ${retentionPeriod} days for collection ${collectionConfig.name}`);
        if (retentionPeriod > 0) {
          const retentionDate = new Date(moment().subtract(retentionPeriod, 'days').toISOString());
          return Repository
            .delete(collectionConfig.name, {
              createdAt: {
                $lt: retentionDate
              }
            })
            .tap(deleteResponse => logger.info(`Records from collection ${collectionConfig.name} deleted. Delete Status - `, _.get(deleteResponse, 'result')))
            .then(deleteResponse => ({
              collection: collectionConfig.name,
              delete_count: _.get(deleteResponse, 'result.n')
            }));
        } else {
          const msg = `Invalid rention period configured for collection ${collectionConfig.name} : ${retentionPeriod}`;
          logger.warn(`${msg}. Collection will not be cleaned`);
          return {
            collection: collectionConfig.name,
            error: msg
          };
        }
      })
      .tap(deleteRes => deleteResponse = deleteRes)
      .then(() => ScheduleManager.purgeOldFinishedJobs())
      .tap((deleteRes) => deleteResponse.push(deleteRes))
      .then(() => this.runSucceeded(deleteResponse, job, done))
      .catch(err => this.runFailed(err, deleteResponse, job, done));
  }
}

module.exports = DbCollectionReaperJob;