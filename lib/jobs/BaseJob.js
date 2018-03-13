'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const os = require('os');
const cluster = require('cluster');
const errors = require('../errors');
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
      const jobType = job.attrs.name;
      //Agenda's name of job is actually the type of job & one could have many instances of same job name
      //scheduled at different times. 
      const options = job.attrs.data;
      if (user === undefined || user.name === undefined) {
        user = CONST.SYSTEM_USER;
      }
      let statusCode, statusMsg;
      let jobResponse = {};
      if (err === undefined) {
        statusCode = CONST.JOB_RUN_STATUS_CODE.SUCCEEDED;
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
        interval: job.attrs.repeatInterval || CONST.NOT_APPLICABLE,
        type: jobType,
        data: options,
        response: jobResponse,
        statusCode: statusCode,
        statusMessage: statusMsg,
        startedAt: job.__started_At,
        processedBy: processId
      };
      return Repository
        .save(CONST.DB_MODEL.JOB_RUN_DETAIL, jobRunDetail, user);
    }).catch(err => {
      const jobName = _.get(job, `attrs.data.${CONST.JOB_NAME_ATTRIB}`);
      logger.error('Error occurred while saving jobrundetails -', jobRunDetail);
      logger.error(`Error occurred while saving run history for job : ${jobName} :`, err);
      return -1;
    });
  }

  static getLastRunStatus(name, jobType) {
    const sortOn = ['createdAt', 'desc'];
    const criteria = {
      sortBy: [sortOn],
      searchBy: {
        name: name,
        type: jobType
      }
    };
    return Repository
      .search(CONST.DB_MODEL.JOB_RUN_DETAIL,
        criteria, {
          records: 1,
          offset: 0
        })
      .then(lastRunDetails => {
        if (_.get(lastRunDetails, 'totalRecordCount', 0) === 0) {
          logger.info(`Last run details is empty for ${name}_${jobType}`);
          return null;
        }
        const lastRunList = lastRunDetails.list;
        const response = {
          lastRunAt: lastRunList[0].startedAt,
        };
        logger.info(`Last run status for ${name}_${jobType} :`, _.pick(lastRunList[0], ['interval', 'data', 'response', 'statusCode', 'statusMessage', 'startedAt', 'createdAt']));
        if (lastRunList[0].statusCode === CONST.JOB_RUN_STATUS_CODE.SUCCEEDED) {
          return _.set(response, 'status', CONST.OPERATION.SUCCEEDED);
        } else {
          _.set(response, 'message', `${lastRunList[0].statusCode} - ${lastRunList[0].statusMessage}`);
          return _.set(response, 'status', CONST.OPERATION.FAILED);
        }
      });
  }

  static getProcessId() {
    return cluster.worker ? `${os.hostname()} - ${cluster.worker.id} - ${process.pid}` : `${os.hostname()}-${process.pid}`;
  }

  static run() {
    throw new NotImplementedBySubclass('run');
  }

  static getRandomRepeatInterval() {
    throw new NotImplementedBySubclass('getRandomRepeatInterval');
  }

  static getFabrikClient() {
    return serviceFabrikClient;
  }

  static getBrokerClient() {
    return serviceBrokerClient;
  }
}

module.exports = BaseJob;