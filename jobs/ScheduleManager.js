'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const pubsub = require('pubsub-js');
var moment = require('moment-timezone');
const utils = require('../common/utils');
const config = require('../common/config');
const Scheduler = require('./Scheduler');
const JobFabrik = require('./JobFabrik');
const errors = require('../common/errors');
const scheduler = new Scheduler();
const Repository = require('../common/db').Repository;
const logger = require('../common/logger');
const CONST = require('../common/constants');

class ScheduleManager {

  static runAt(name, jobType, runAt, jobData, user, avoidDupJobWithSameData) {
    let agendaJob = {};
    return scheduler
      .runAt(name, jobType, runAt, jobData, avoidDupJobWithSameData)
      .tap(job => agendaJob = job)
      .then(() => this.saveJob(name, jobType, runAt, jobData, user, true))
      .then(jobInDB => this.getJobAttrs(jobInDB, agendaJob));
  }

  static schedule(name, jobType, interval, jobData, user) {
    return Promise.try(() => {
      let agendaJob = {};
      if (interval === CONST.SCHEDULE.DAILY) {
        interval = this.getRandomDailySchedule();
        logger.info(`Schedule interval input as 'daily'. So setting following daily random schedule - ${interval}`);
      } else if (interval.indexOf('hours') !== -1) {
        interval = this.getRandomHourlySchedule(interval);
        logger.info(`human hours interval input, so setting following hourly random schedule - ${interval}`);
      } else if (interval === CONST.SCHEDULE.RANDOM) {
        const JobDefinition = JobFabrik.getJob(jobType);
        interval = JobDefinition.getRandomRepeatInterval();
      }
      return scheduler
        .schedule(name, jobType, interval, jobData)
        .tap(job => agendaJob = job)
        .then(() => this.saveJob(name, jobType, interval, jobData, user, false))
        .then(jobInDB => this.getJobAttrs(jobInDB, agendaJob));
    });
  }

  static scheduleDaily(name, jobType, jobData, user) {
    return this.schedule(name, jobType, CONST.SCHEDULE.DAILY, jobData, user);
  }

  static getRandomDailySchedule() {
    const hr = utils.getRandomInt(0, 23);
    const min = utils.getRandomInt(0, 59);
    return `${min} ${hr} * * *`;
  }

  static getRandomHourlySchedule(interval) {
    try {
      const everyXhrs = parseInt(/^[0-9]+/.exec(interval)[0]);
      logger.info(`schedule is to run every ${everyXhrs} hours`);
      if (24 % everyXhrs === 0) {
        //only for intervals whose multiple leads to 24 can we create a random cron. 
        //For ex., with 7, we cant create a true random cron as it can lead to '34 1,8,15,22 * * *'
        return utils.getRandomCronForEveryDayAtXHoursInterval(everyXhrs);
      } else {
        return interval;
      }
    } catch (err) {
      throw new errors.BadRequest(`invalid interval ${interval} - hours must be valid integer`);
    }
  }

  static saveJob(name, inputJobType, interval, jobData, user, runOnce) {
    let jobType = inputJobType;
    if (runOnce) {
      jobType = `${jobType}_${new Date().getTime()}`;
      //If job is being run once, then it should always result in new entry,
      //hence tweak insert criteria to ensure it never finds a record and always results in create.
    }
    const criteria = {
      name: name,
      type: jobType
    };
    const jobDetails = {
      name: name,
      type: jobType,
      interval: interval,
      data: jobData,
      runOnlyOnce: runOnce
    };
    logger.debug(`Saving Job - ${name}`);
    return Repository
      .saveOrUpdate(CONST.DB_MODEL.JOB, jobDetails, criteria, user)
      .then((jobInDb) => runOnce ? jobInDb : this.updateLastRunStatus(jobInDb, name, inputJobType));
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
        if (job === null) {
          throw new errors.NotFound(`Schedule not found for instance ${name} for job type ${jobType}`);
        }
        return this.getJob(name, jobType);
      })
      .then(jobInDB => this.getJobAttrs(jobInDB, agendaJob));
  }

  static cancelSchedule(name, jobType) {
    logger.debug(`cancelling schedule : ${name}_${jobType}`);
    return scheduler
      .cancelJob(name, jobType)
      .then(() => this.deleteJob(name, jobType));
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
    return Repository
      .findOne(CONST.DB_MODEL.JOB, criteria)
      .then(jobInDb => this.updateLastRunStatus(jobInDb, name, jobType));
  }

  static updateLastRunStatus(jobInDb, name, jobType) {
    return Promise.try(() => {
      if (jobInDb !== null) {
        const JobDefinition = JobFabrik.getJob(jobType);
        if (JobDefinition.getLastRunStatus !== undefined && typeof JobDefinition.getLastRunStatus === 'function') {
          const jobNameInRunHistory = jobInDb.data.instance_id || jobInDb.data.deployment_name || jobInDb.data._n_a_m_e_;
          //see BaseJob.logRunHistory
          return JobDefinition
            .getLastRunStatus(jobNameInRunHistory, jobType)
            .then(jobRunStatus => jobInDb.lastRunDetails = jobRunStatus)
            .return(jobInDb);
        }
      }
      return jobInDb;
    });
  }

  static getJobAttrs(jobInDB, agendaJob) {
    const dbAttrs = _.pick(jobInDB, 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', 'lastRunDetails');
    const lastRunAt = _.get(jobInDB, 'lastRunDetails.lastRunAt', agendaJob.lastRunAt);
    return _
      .chain(agendaJob)
      .assign(dbAttrs)
      .set('name', `${jobInDB.name}_${agendaJob.name}`)
      .set('lastRunAt', lastRunAt)
      .value();
  }

  static setupSystemJobs() {
    const systemJobDefinition = config.scheduler.system_jobs;
    return Promise.map(systemJobDefinition, (jobDefinition) => {
      //return added only for UT
      if (jobDefinition.enabled === false) {
        logger.info('Cancelling system job', jobDefinition);
        return this.cancelSchedule(jobDefinition.name, jobDefinition.type);
      }
      let scheduleSystemJob = false;
      return this
        .getSchedule(jobDefinition.name, jobDefinition.type)
        .then(jobDetails => scheduleSystemJob = jobDetails.repeatInterval !== jobDefinition.interval)
        .catch(errors.NotFound, () => scheduleSystemJob = true)
        .finally(() => {
          if (scheduleSystemJob) {
            logger.info(`System job: ${jobDefinition.name} of type ${jobDefinition.type} scheduled for ${jobDefinition.interval}`);
            this
              .schedule(
                jobDefinition.name,
                jobDefinition.type,
                jobDefinition.interval,
                jobDefinition.job_data,
                CONST.SYSTEM_USER);
          } else {
            logger.info(`System job: ${jobDefinition.name} of type ${jobDefinition.type} is already scheduled for ${jobDefinition.interval}`);
          }
        });
    });
  }

  static purgeOldFinishedJobs() {
    return Promise.try(() => {
      const retentionDate = new Date(moment().subtract(CONST.FINISHED_JOBS_RETENTION_DURATION_DAYS, 'days').toISOString());
      const criteria = [];
      criteria.push({
        createdAt: {
          $lt: retentionDate
        }
      });
      criteria.push({
        runOnlyOnce: true
      });
      criteria.push({
        type: '/.*_[0-9]+/'
      });
      return scheduler
        .purgeOldFinishedJobs()
        .then(() => Repository.delete(CONST.DB_MODEL.JOB, {
          $and: criteria
        }))
        .then(deleteResponse => ({
          collection: CONST.DB_MODEL.JOB,
          delete_count: _.get(deleteResponse, 'result.n')
        }))
        .catch(err => {
          logger.error('Error occurred while purging old finished jobs :', err);
          return {
            collection: CONST.DB_MODEL.JOB,
            error: err.reason || err.message
          };
        });
    });
  }

  static init() {
    pubsub.subscribe(CONST.TOPIC.SCHEDULER_STARTED, () => ScheduleManager.setupSystemJobs());
  }
}
ScheduleManager.init();

module.exports = ScheduleManager;