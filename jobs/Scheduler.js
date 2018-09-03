'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const pubsub = require('pubsub-js');
const os = require('os');
var moment = require('moment-timezone');
Promise.promisifyAll([
  require('agenda/lib/agenda'),
  require('agenda/lib/job')
]);
const Agenda = require('agenda');
const CronTime = require('cron').CronTime;
const humanInterval = require('human-interval');
const logger = require('../common/logger');
const config = require('../common/config');
const CONST = require('../common/constants');
const JobFabrik = require('./JobFabrik');
const BaseJob = require('./BaseJob');
const errors = require('../common/errors');
const maintenanceManager = require('../maintenance').maintenanceManager;
const BadRequest = errors.BadRequest;
const ServiceUnavailable = errors.ServiceUnavailable;
const ServiceInMaintenance = errors.ServiceInMaintenance;
const MONGO_TO_BE_INITIALIZED = 0;
const MONGO_INIT_FAILED = 1;
const MONGO_INIT_SUCCEEDED = 2;

class Scheduler {
  constructor() {
    this.initialized = MONGO_TO_BE_INITIALIZED;
    this.jobs = {};
    this.time = new Date();
    this.config = config.scheduler;
    this.runWithWebProcess = this.config.run_with_web_process === undefined || this.config.run_with_web_process === true;
    logger.info(`Scheduler running in : ${process.env.job === undefined ? 'Web Mode' : 'Batch Job Mode'} - ${process.pid} - can scheduler run with web process : ${this.runWithWebProcess}`);
    const jobTypes = _.get(this.config, 'job_types', '').replace(/\s*/g, '');
    this.jobTypeList = jobTypes !== '' ? jobTypes.split(',') : [];
    logger.info('list of configured jobs:', jobTypes);
    if (this.jobTypeList.length === 0) {
      logger.warn('No JobTypes configured. Scheduler is not going to be started & mongo operational events will not be subscribed');
      return;
    }
    this.MONGO_OP_TOPIC = pubsub.subscribe(CONST.TOPIC.MONGO_OPERATIONAL, (eventName, eventInfo) => this.initialize(eventName, eventInfo));
    this.MONGO_FAIL_TOPIC = pubsub.subscribe(CONST.TOPIC.MONGO_INIT_FAILED, () => {
      logger.warn('MongoDB is not operational. Scheduling services will not be available');
      this.initialized = MONGO_INIT_FAILED;
    });
    this.APP_SHUTDOWN_TOPIC = pubsub.subscribe(CONST.TOPIC.APP_SHUTTING_DOWN, () => this.shutDownHook());
  }

  initialize(eventName, eventInfo) {
    try {
      logger.debug('+-> Received event :', eventName);
      logger.info(`Agenda is configured to work with collection - ${this.config.agenda_collection}`);
      const processId = BaseJob.getProcessId();
      this.agenda = new Agenda({
        mongo: eventInfo.mongoose.connection.collection(this.config.agenda_collection).conn.db,
        //Reusing the connection from Mongoose connection pool
        db: {
          collection: this.config.agenda_collection
        },
        //collection for agenda
        name: processId
        //'lastmodifiedby' for agendaJobs - can be helpful when multiple schedulers are running
      });
      /**
       * Regarding setting up mongoose connection in agenda refer below:
       * https://github.com/rschmukler/agenda/issues/156#issuecomment-163700272
       * Need to ensure the same Mongoose instance is referenced.
       *
       * The above is not needed as part of the latest fix in agenda, however its not yet published.
       * https://github.com/rschmukler/agenda/issues/395
       * So the above could be removed once the fix is made available.
       */

      if (process.env.job) {
        const cpuCount = os.cpus().length;
        if (this.config.max_workers && this.config.max_workers < cpuCount) {
          this.config.process_every = `${this.config.max_workers} minutes`;
        } else {
          this.config.process_every = `${cpuCount - 1} minutes`;
        }
        //When running in job scheduler mode, jobs per cpus are spawned. Each worker will be spawned with a delay of 1 minute 
        //Having each worker goto DB once every $cpuCount minute, creates a sliding window of 1 minute. 
      }
      logger.info(`Agenda will process db once every:${this.config.process_every}`);
      this.agenda
        .processEvery(this.config.process_every) //the frequency at which agenda will query the database looking for jobs that need to be processed
        .maxConcurrency(this.config.max_concurrency) //number which specifies the max number of jobs that can be running at any given moment
        .defaultConcurrency(this.config.default_concurrency) //number which specifies the default number of a specific job that can be running at any given moment
        .defaultLockLifetime(this.config.default_lock_lifetime) //specifies the default lock lifetime in milliseconds. (keeping it as 3 mins)
        .on('ready', () => this.startScheduler())
        .on('error', (err) => Promise.try(() => {
          logger.error('Error occurred, scheduling services will be unavailable.', err);
          //Just log error. DB Connection manager already handles retry.
        }));
      logger.info('init agenda complete!');
    } catch (error) {
      logger.error('Exception occurred while initializing scheduler', error);
    }
  }

  startScheduler() {
    logger.info('Agenda is connected to DB. Ready to Schedule the jobs');
    return this
      .registerJobDefinitions()
      .then(() => {
        logger.debug(`process.env.job: ${process.env.job} - runWithWebProcess : ${this.runWithWebProcess}`);
        if (process.env.job || this.runWithWebProcess) {
          //Only in Job mode, start agenda.
          logger.debug('starting scheduler...');
          this.agenda.start();
          pubsub.publish(CONST.TOPIC.SCHEDULER_STARTED);
        } else {
          logger.info(`Agenda Scheduler not started. process.env.job : ${process.env.job} - run_with_web_process : ${this.runWithWebProcess}`);
        }
        this.initialized = MONGO_INIT_SUCCEEDED;
        pubsub.publish(CONST.TOPIC.SCHEDULER_READY);
      })
      .catch(err => logger.error(err));
  }

  registerJobDefinitions() {
    return Promise
      .try(() => {
        logger.debug(`Checking configured Job Types & Registering Job Definitions for : ${this.jobTypeList}`);
        _.each(this.jobTypeList, (jobType) => {
          try {
            this.define(jobType, JobFabrik.getJob(jobType));
          } catch (err) {
            logger.error(`error occurred while registering job defintion : ${jobType}`, err);
          }
        });
      });
  }

  define(jobType, jobDefinition) {
    logger.info(`defining jobtype: ${jobType}`);
    this
      .agenda
      .define(jobType, (job, done) => this.runJob(jobType, jobDefinition, job, done));
  }

  runJob(jobType, jobDefinition, job, done) {
    return maintenanceManager
      .getMaintenaceInfo()
      .then((maintenanceInfo) => {
        job.__started_At = new Date();
        const jobData = _.get(job.attrs, 'data', {});
        if (jobData.attempt === undefined || jobData.attempt === 1) {
          jobData.attempt = 1;
          jobData.firstAttemptAt = new Date();
        }
        if (maintenanceInfo === null ||
          maintenanceManager.getLastDowntimePhase(maintenanceInfo, config.scheduler.downtime_maintenance_phases) === undefined) {
          return jobDefinition.run(job, done);
        }
        //System in maintenance Mode.
        //Mark current run as failed and reschedule job & exit the process. [JobScheduler takes care of recreation]
        return jobDefinition
          .runFailed(ServiceInMaintenance.getInstance(maintenanceInfo), 'System in maintenance', job, done)
          .then(() => this.reScheduleJob(jobType, job))
          .then(() => process.exit(CONST.ERR_CODES.SF_IN_MAINTENANCE));
      })
      .catch(err => logger.error('Error occurred while running Job :', err));
  }

  /**
   * Agenda lib internally depends on cron lib for Cron/CronTime module.
   * Validation method in the below is on the same lines as documented
   * in Cron library: https://github.com/kelektiv/node-cron
   * Additionally check for valid human readable time durations
   */
  validateInterval(interval) {
    try {
      /* jshint unused:false*/
      logger.debug('validating interval %s', interval);
      const timeInterval = new CronTime(interval);
      return CONST.SCHEDULE_INTERVAL.CRON_EXPRESSION;
    } catch (ex) {
      const nextRun = humanInterval(interval);
      logger.debug('next run - human internval', nextRun);
      if (!isNaN(nextRun)) {
        return CONST.SCHEDULE_INTERVAL.HUMAN_INTERVAL;
      }
      logger.error(`Invalid interval - ${interval}. Must be a valid cron expression or a valid human readable duration`);
      throw new BadRequest(`Invalid interval - ${interval}. Must be a valid cron expression or a valid human readable duration`);
    }
  }

  isJobTypeEnabled(jobType) {
    if (this.jobTypeList.indexOf(jobType) === -1) {
      throw new ServiceUnavailable(`${jobType} is not enabled in the system. Cannot be scheduled`);
    }
  }

  schedule(name, jobType, interval, data) {
    return Promise
      .try(() => {
        if (this.initialized !== MONGO_INIT_SUCCEEDED) {
          //mongoDB is not initialized then cannot run the job currently.
          logger.error(`${name}_${jobType} cant be scheduled as mongodb is non-operational. Init status : ${this.initialized}`);
          throw new ServiceUnavailable('MongoDB not operational');
        }
        const scheduleIntervalType = this.validateInterval(interval);
        logger.info(`Scheduling Job ${name}-${jobType} with ${scheduleIntervalType}`);
        this.isJobTypeEnabled(jobType);
        let options;
        if (data) {
          if (data.timeZone) {
            if (moment.tz.names().indexOf(data.timeZone) === -1) {
              throw new BadRequest(`Invalid timezone. Valid zones: ${JSON.stringify(moment.tz.names())}`);
            }
            options = {
              timezone: data.timeZone
            };
            delete data.timeZone;
          }
        } else {
          data = {};
        }
        const jobName = `${name}_${jobType}`;
        logger.info(`Scheduled Job : ${jobName} for interval : ${interval}`);
        data[CONST.JOB_NAME_ATTRIB] = jobName;
        const job = this.agenda.create(jobType, data);
        job.unique({
          'data._n_a_m_e_': jobName
        });
        job.repeatEvery(interval, options);
        job.attrs.lastRunAt = new Date();
        //This is to fix the agendaJS bug which runs the jobs immediately if scheduled with human-interval
        //Setting this job attrib ensures it skips setting nextrun immediately for human-intervals
        job.computeNextRunAt();
        delete job.attrs.lastRunAt;
        //After dodging computeNextRunAt, delete it else it gives a wrong indication that job was run
        return job
          .saveAsync()
          .then(() => this.getJob(name, jobType));
      });
  }

  runAt(name, jobType, runAt, data, avoidDupJobWithSameData) {
    return Promise
      .try(() => {
        if (this.initialized !== MONGO_INIT_SUCCEEDED) {
          //mongoDB is not initialized then cannot run the job currently.
          logger.error(`${name}_${jobType} cant be scheduled @${runAt} as mongodb is non-operational. Init status : ${this.initialized}`);
          throw new ServiceUnavailable('MongoDB not operational');
        }
        this.isJobTypeEnabled(jobType);
        const jobName = `${name}_${jobType}_${runAt.replace(/\s*/g, '')}_${new Date().getTime()}`;
        logger.info(`Scheduling Job : ${jobName} to Run @ ${runAt}`);
        data = data ? _.omit(data, CONST.JOB_NAME_ATTRIB) : {};
        const uniqueCriteria = {};
        if (avoidDupJobWithSameData) {
          _.each(data, (attrValue, attr) => {
            uniqueCriteria[`data.${attr}`] = attrValue;
            return true;
          });
        } else {
          uniqueCriteria['data._n_a_m_e_'] = jobName;
        }
        logger.info('Setting Job with Unique Criteria : ', uniqueCriteria);
        data[CONST.JOB_NAME_ATTRIB] = jobName;
        const job = this.agenda.create(jobType, data);
        job.unique(uniqueCriteria);
        job.schedule(runAt);
        return job
          .saveAsync()
          .then(() => this.getJob(name, jobType));
        //Fetching again from Agenda DB, as few of the persistent fields (like. lastRunAt, etc.) 
        //are not returned as part of save
      });
  }

  runNow(name, jobType, data) {
    return Promise
      .try(() => {
        if (this.initialized !== MONGO_INIT_SUCCEEDED) {
          //mongoDB is not initialized then cannot run the job currently.
          logger.error(`${name}_${jobType} cant be scheduled to run now as mongodb is non-operational. Init status : ${this.initialized}`);
          throw new ServiceUnavailable('MongoDB not operational');
        }
        this.isJobTypeEnabled(jobType);
        const jobName = `${name}_${jobType}_${new Date().getTime()}`;
        data = data ? data : {};
        data[CONST.JOB_NAME_ATTRIB] = jobName;
        const job = this.agenda.create(jobType, data);
        job.unique({
          'data._n_a_m_e_': jobName
        });
        return job
          .saveAsync()
          .then(() => job.runAsync())
          .then(() => this.getJob(name, jobType));
      });
  }

  getJob(name, jobType) {
    return Promise
      .try(() => {
        if (this.initialized !== MONGO_INIT_SUCCEEDED) {
          logger.error(`${name}_${jobType} cant be retrieved as mongodb is non-operational. Init status : ${this.initialized}`);
          throw new ServiceUnavailable('MongoDB not operational');
        }
        const criteria = {
          name: jobType,
          nextRunAt: {
            $ne: null
          }
        };
        const jobName = `${name}_${jobType}`;
        criteria[`data.${CONST.JOB_NAME_ATTRIB}`] = {
          $regex: `^${jobName}.*`
        };
        logger.debug('getting job with criteria :', criteria);
        return this
          .agenda
          .jobsAsync(criteria)
          .then(jobs => {
            const scheduledJob = _.filter(jobs, (job) => job.attrs.data[CONST.JOB_NAME_ATTRIB] === jobName);
            if (scheduledJob.length > 0) {
              const sortedList = _.sortBy(jobs, (job) => job.attrs.nextRunAt);
              scheduledJob[0].attrs.nextRunAt = sortedList[0].attrs.nextRunAt;
              return this.getJobAttrs(scheduledJob[0]);
              //As part of retry mechanism for scheduled job (with repeat interval), one time jobs are scheduled 
              //with a delay of 'config.scheduler.jobs.reschedule_delay' in case of errors. So there would be two 
              //jobs that will run next (one-time job scheduled as part of retry on error and the regular job as defined interval)
              //Need to set nextRunTime based on the job that is to run immediately from the current time for the given jobtype & name.
            }
            return null;
          });
      });
  }

  cancelJob(name, jobType) {
    return Promise
      .try(() => {
        if (this.initialized !== MONGO_INIT_SUCCEEDED) {
          logger.error('Scheduler not yet initialized! MongoDB not operational');
          throw new ServiceUnavailable('MongoDB not operational');
        }
        logger.info(`Cancelling schedule for job ${name} - ${jobType}`);
        const criteria = {
          name: jobType
        };
        criteria[`data.${CONST.JOB_NAME_ATTRIB}`] = `${name}_${jobType}`;
        return this
          .agenda
          .cancelAsync(criteria)
          .then(() => {
            return {};
          });
      });
  }

  purgeOldFinishedJobs() {
    return Promise.try(() => {
      //One time jobs which have run only once need not be stored any longer in DB beyond the job retention period.
      const retentionDate = new Date(moment().subtract(CONST.FINISHED_JOBS_RETENTION_DURATION_DAYS, 'days').toISOString());
      const criteria = [];
      criteria.push({
        lastFinishedAt: {
          $lt: retentionDate
        }
      });
      criteria.push({
        nextRunAt: null
      });
      //nextRunAt null indicates that its a one time job which will not run in future.
      criteria.push({
        type: 'normal'
      });
      //jobtype normal only should be purged. Single type of jobs are repetitive and must be left alone.
      return this
        .agenda
        .cancelAsync({
          $and: criteria
        })
        .tap((response) => logger.debug('Purged old Agenda Jobs from the System : ', _.get(response, 'result')));
    });
  }

  reScheduleJob(type, job) {
    return Promise.try(() => {
      const jobData = _.omit(job.attrs.data, `${CONST.JOB_NAME_ATTRIB}`);
      const jobName = job.attrs.data[CONST.JOB_NAME_ATTRIB].split('_')[0];
      logger.info(`Re-Schedulding Job for ${jobName} - ${type} @ ${config.scheduler.jobs.reschedule_delay}`);
      return this
        .runAt(jobName,
          type,
          config.scheduler.jobs.reschedule_delay,
          jobData
        );
    });
  }

  getJobAttrs(job) {
    const data = _.omit(job.attrs.data, '_n_a_m_e_');
    return _
      .chain(job.attrs)
      .pick('name', 'nextRunAt', 'repeatInterval', 'lastRunAt', 'lockedAt', 'repeatTimezone', 'failedAt', 'failCount', 'failReason')
      .set('data', data)
      .value();
  }

  shutDownHook() {
    if (this.initialized === MONGO_INIT_SUCCEEDED) {
      logger.info('Stopping agenda');
      this.agenda.stop();
    }
    pubsub.unsubscribe(this.MONGO_OP_TOPIC);
    pubsub.unsubscribe(this.MONGO_FAIL_TOPIC);
    pubsub.unsubscribe(this.APP_SHUTDOWN_TOPIC);
    const worker = process.env.job ? `Worker - PID :${process.pid}` : `PID : ${process.pid}`;
    logger.info(`Scheduler ${worker} shutdown complete`);
  }
}

module.exports = Scheduler;
//Scheduler should not be referenced directly in any other modules of app.
//ScheduleManager is the external facing entity for all modules in the app & it maintains a single instance of scheduler.