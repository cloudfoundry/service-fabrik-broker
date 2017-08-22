'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const pubsub = require('pubsub-js');
const utils = require('../utils');
const config = require('../config');
const Scheduler = require('./Scheduler');
const errors = require('../errors');
const scheduler = new Scheduler();
const Repository = require('../db').Repository;
const logger = require('../logger');
const CONST = require('../constants');

class ScheduleManager {

  static runAt(name, jobType, runAt, jobData, user) {
    let agendaJob = {};
    return scheduler
      .runAt(name, jobType, runAt, jobData)
      .tap(job => agendaJob = job)
      .then(() => this.saveJob(name, jobType, runAt, jobData, user, true))
      .then(jobInDB => this.getJobAttrs(jobInDB, agendaJob));
  }

  static schedule(name, jobType, interval, jobData, user) {
    let agendaJob = {};
    if (interval === CONST.BACKUP.SCHEDULE.DAILY) {
      interval = this.getRandomDailySchedule();
      logger.info(`Schedule interval input as 'daily'. So setting following daily random schedule - ${interval}`);
    }
    return scheduler
      .schedule(name, jobType, interval, jobData)
      .tap(job => agendaJob = job)
      .then(() => this.saveJob(name, jobType, interval, jobData, user))
      .then(jobInDB => this.getJobAttrs(jobInDB, agendaJob));
  }

  static scheduleDaily(name, jobType, jobData, user) {
    return this.schedule(name, jobType, CONST.BACKUP.SCHEDULE.DAILY, jobData, user);
  }

  static getRandomDailySchedule() {
    const hr = utils.getRandomInt(0, 23);
    const min = utils.getRandomInt(0, 59);
    return `${min} ${hr} * * *`;
  }

  static saveJob(name, jobType, interval, jobData, user, runOnce) {
    const jobDetails = {
      name: name,
      type: jobType,
      interval: interval,
      data: jobData
    };
    if (runOnce) {
      jobType = `${jobType}_${new Date().getTime()}`;
      //If job is being run once, then it should always result in new entry,
      //hence tweak insert criteria to ensure it never finds a record and always results in create.
    }
    const criteria = {
      name: name,
      type: jobType
    };
    logger.debug(`Saving Job - ${name}`);
    return Repository.saveOrUpdate(CONST.DB_MODEL.JOB, jobDetails, criteria, user);
  }

  static getSchedule(name, jobType) {
    let agendaJob = {};
    logger.debug(`Retrieving schedule for ${name}`);
    return scheduler
      .getJob(name, jobType)
      .tap(job => {
        agendaJob = job;
        logger.debug(`Job retrieved from agenda for : ${name} - ${jobType}`);
      })
      .then((job) => {
        if (job === null || (job.constructor === Object && Object.keys(job).length === 0)) {
          throw new errors.NotFound(`Schedule not found for instance ${name}`);
        }
        return this.getJob(name, jobType);
      })
      .then(jobInDB => this.getJobAttrs(jobInDB, agendaJob));
  }

  static cancelSchedule(name, jobType) {
    logger.debug(`cancelling schedule : ${name}_${jobType}`);
    return scheduler
      .cancelJob(name, jobType)
      .then(() => this.deleteJob(name, jobType))
      .catch(err => {
        logger.error(`error occurred while cancelling job :${name}_${jobType}`, err);
        return Promise.resolve({});
      });
  }

  static deleteJob(name, jobType) {
    logger.debug(`Deleting Job : ${name}_${jobType}`);
    const criteria = {
      name: name,
      type: jobType
    };
    return Repository.delete(CONST.DB_MODEL.JOB, criteria);
  }

  static getJob(name, jobType) {
    const criteria = {
      name: name,
      type: jobType
    };
    return Repository.findOne(CONST.DB_MODEL.JOB, criteria);
  }

  static getJobAttrs(jobInDB, agendaJob) {
    const dbAttrs = _.pick(jobInDB, 'createdBy', 'updatedBy', 'createdAt', 'updatedAt');
    return _
      .chain(agendaJob)
      .assign(dbAttrs)
      .set('name', `${jobInDB.name}_${agendaJob.name}`)
      .value();
  }

  static setupSystemJobs() {
    const systemJobDefinition = config.scheduler.system_jobs;
    _.each(systemJobDefinition, (jobDefinition) => {
      if (jobDefinition.enabled === false) {
        logger.info('Cancelling system job', jobDefinition);
        return this.cancelSchedule(jobDefinition.name, jobDefinition.type);
      }
      return this
        .schedule(
          jobDefinition.name,
          jobDefinition.type,
          jobDefinition.interval,
          jobDefinition.job_data,
          CONST.SYSTEM_USER);
    });
  }

  static init() {
    pubsub.subscribe(CONST.TOPIC.SCHEDULER_STARTED, () => ScheduleManager.setupSystemJobs());
  }
}
ScheduleManager.init();

module.exports = ScheduleManager;