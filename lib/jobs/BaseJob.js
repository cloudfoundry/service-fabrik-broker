'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const moment = require('moment');
const os = require('os');
const cluster = require('cluster');
const errors = require('../errors');
const config = require('../config');
const logger = require('../logger');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;
const CONST = require('../constants');
const serviceFabrikClient = require('../cf').serviceFabrikClient;
const serviceBrokerClient = require('../utils').serviceBrokerClient;
const Repository = require('../db').Repository;

class BaseJob {

  static runSucceeded(response, job, done, user) {
    logger.info(`Job : ${job.attrs.data[CONST.JOB_NAME_ATTRIB]} - succeeded: ${JSON.stringify(response)}`);
    return this.logRunHistory(undefined, response, job, user)
      .then(() => done());
  }

  static runFailed(err, response, job, done, user) {
    return Promise.try(() => {
      logger.error(`Job : ${job.attrs.data[CONST.JOB_NAME_ATTRIB]} - failed. More info: `, err);
      //Update Agenda Job status as failed
      job.fail(err);
      job.save();
      logger.info(`Job -  ${job.attrs.data[CONST.JOB_NAME_ATTRIB]} - Response : `, response);
      return this.logRunHistory(err, response, job, user)
        .then(() => done());
    });
  }

  static logRunHistory(err, response, job, user) {
    let jobRunDetail;
    return Promise.try(() => {
      const jobType = _.split(job.attrs.name, '_').pop();
      const options = job.attrs.data;
      if (user === undefined || user.name === undefined) {
        user = CONST.SYSTEM_USER;
      }
      let statusCode, statusMsg;
      let jobResponse = {};
      if (err === undefined) {
        statusCode = '0';
        statusMsg = 'run successful';
        jobResponse = response;
      } else {
        statusCode = err.statusCode || err.status || CONST.ERR_CODES.UNKNOWN;
        statusMsg = err.statusMessage || err.reason || err.message || 'run failed';
        jobResponse.jobStatus = response;
        jobResponse.error = err;
      }
      const processId = this.getProcessId();
      jobRunDetail = {
        name: options.instance_id || options.deployment_name || options._n_a_m_e_,
        interval: job.attrs.repeatInterval,
        type: jobType,
        data: options,
        response: jobResponse,
        statusCode: statusCode,
        statusMessage: statusMsg,
        startedAt: job.__started_At,
        processedBy: processId
      };
      const retentionDate = new Date(moment().subtract(config.scheduler.job_history_retention_in_days, 'days').toISOString());
      return Repository
        .save(CONST.DB_MODEL.JOB_RUN_DETAIL, jobRunDetail, user)
        .then(() => Repository
          .delete(CONST.DB_MODEL.JOB_RUN_DETAIL, {
            createdAt: {
              $lt: retentionDate
            }
          }));
    }).catch(err => {
      const jobName = _.get(job, `attrs.data.${CONST.JOB_NAME_ATTRIB}`);
      logger.error('Error occurred while saving jobrundetails -', jobRunDetail);
      logger.error(`Error occurred while saving run history for job : ${jobName} :`, err);
      return -1;
    });
  }

  static getProcessId() {
    return cluster.worker ? `${os.hostname()} - ${cluster.worker.id} - ${process.pid}` : `${os.hostname()}-${process.pid}`;
  }
  static run() {
    throw new NotImplementedBySubclass('run');
  }

  static getFabrikClient() {
    return serviceFabrikClient;
  }

  static getBrokerClient() {
    return serviceBrokerClient;
  }
}

module.exports = BaseJob;