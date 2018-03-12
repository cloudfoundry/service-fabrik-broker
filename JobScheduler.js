'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const pubsub = require('pubsub-js');
const cluster = require('cluster');
const moment = require('moment');
const cpus = require('os').cpus();
const CONST = require('./lib/constants');
const logger = require('./lib/logger');
const config = require('./lib/config');
const errors = require('./lib/errors');
const maintenanceManager = require('./lib/maintenance').maintenanceManager;
require('./lib/fabrik');

let cpuCount = cpus.length;
let maxWorkers = 0;

//Assuming broker/jobscheduler are running on same VM, keeping the # jobs 1 less than cpu count. 
cpuCount = cpuCount > 1 ? cpuCount - 1 : 1;
if (config.scheduler.max_workers && config.scheduler.max_workers < cpuCount) {
  maxWorkers = config.scheduler.max_workers;
} else {
  maxWorkers = cpuCount;
}

class JobScheduler {
  constructor() {
    this.ready = Promise.try(() => {
      this.jobWorkers = [];
      this.workerCount = 0;
      this.workerType = '';
      this.serviceFabrikInMaintenance = true;
      this.intervalTimer = undefined;
      this.shutDownHook = () => this.shutDown();
      process.on('SIGTERM', this.shutDownHook);
      process.on('SIGINT', this.shutDownHook);
      this.unhandleRejectionHook = (reason, p) => this.processUnhandledRejection(reason, p);
      process.on('unhandledRejection', this.unhandleRejectionHook);
      if (cluster.isMaster) {
        //This delay is added to ensure that DBManager is initialized prior to scheduler 
        //checking for maintenance status. Retry is anyways part of this check, but this 
        //delay ensures we dont have exception always on first try. 
        logger.info(`Scheduler will now sleep for ${config.scheduler.start_delay} (ms) before initializing...`);
        return Promise
          .delay(config.scheduler.start_delay)
          .then(() => this.ensureSystemNotInMainenanceThenInitMaster());
      } else {
        return this.initWorker();
      }
    });
  }

  initMaster() {
    this.serviceFabrikInMaintenance = false;
    logger.info(`Configured number of workers ${config.scheduler.max_workers} - No. of CPUs : ${cpus.length} - job workers : ${maxWorkers}`);
    this.workerType = `MASTER - ${process.pid}`;
    cluster.on('exit', (worker, code, signal) => this.workerExitHandler(worker, code, signal));
    // Create a worker for each CPU
    for (var i = 0, delay = 0; i < maxWorkers; i += 1, delay += CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY) {
      logger.debug(`Set scheduled job worker ${i} with delay ${delay} - ${this.workerCount}`);
      //Agenda Scheduler for each worker will be configured to processJobQueue once every ${maxWorkers} minutes.
      //So each worker job is started with a delay of 1 minute, as it creates a constant sliding window of 1 min
      setTimeout(() => this.addJobWorker(), delay);
    }
  }

  initWorker() {
    this.workerType = `Worker - ${cluster.worker.id} - ${process.pid}`;
    logger.info(`Starting Service Fabrik Batch Job worker: ${cluster.worker.id} - ${process.pid}  @${new Date()}`);
    require('./lib/jobs');
    process.on('message', this.handleMessage);
  }

  handleMessage(msg) {
    logger.info(`recieved message :${msg} in - ${this.workerType} `);
    if (msg === CONST.TOPIC.APP_SHUTTING_DOWN) {
      pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
      setTimeout(() => {
        logger.info(`ServiceFabrik Batch Job ${this.workerType} shutdown complete ---`);
        process.exit(2);
      }, CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME);
    }
  }

  workerExitHandler(worker, code, signal) {
    //Individual worker crashes are restarted by cluster itself. Entire process crash is to be handled via MONIT
    logger.error(`exit signal recieved for  Batch Job worker - ${worker.id} - code: ${code} - signal: ${signal}`);
    if (code === CONST.ERR_CODES.SF_IN_MAINTENANCE) {
      logger.info('System is in maintenance, stop all workers');
      this.placeSchedulerInMaintenance();
    }
    setTimeout(() => {
      logger.info(`Batch Job worker :${worker.id} - ${process.pid} shutdown complete`);
      this.removeJobWorker(worker.id);
      this.addJobWorker();
    }, CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY);
  }

  placeSchedulerInMaintenance() {
    this.serviceFabrikInMaintenance = true;
    _.each(this.jobWorkers, (id, key) => {
      logger.info(`+-> message From -> ${this.workerType} - To worker - ${id} - ${key}-${JSON.stringify(cluster.workers[key])}}`);
      cluster.workers[key].send(CONST.TOPIC.APP_SHUTTING_DOWN);
    });
    this.workerCount = 0;
    this.jobWorkers = [];
    this.ensureSystemNotInMainenanceThenInitMaster();
  }

  addJobWorker() {
    logger.info('adding worker : ', !this.serviceFabrikInMaintenance);
    if (!this.serviceFabrikInMaintenance) {
      this.workerCount++;
      const worker = cluster.fork({
        job: 1,
        worker: this.workerCount
      });
      this.jobWorkers.push(worker.id);
    }
  }

  removeJobWorker(id) {
    this.workerCount--;
    this.jobWorkers.splice(this.jobWorkers.indexOf(id), 1);
  }

  shutDown() {
    logger.info(`ServiceFabrik Batch Job ${this.workerType} shutting down shortly...`);
    pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
    const waitBeforeShutdown = CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME;
    setTimeout(() => {
      logger.info(`ServiceFabrik Batch Job ${this.workerType} shutdown complete`);
      process.exit(2);
    }, waitBeforeShutdown);
  }

  pollMaintenanceStatus() {
    const checkMaintenanceStatus = (resolve, reject) => {
      return maintenanceManager
        .getLastMaintenaceState()
        .then(maintenanceInfo => {
          if (maintenanceInfo === null || _.get(maintenanceInfo, 'state', '') === CONST.OPERATION.SUCCEEDED) {
            logger.info('+-> System is not in maintenance');
            if (this.intervalTimer) {
              clearInterval(this.intervalTimer);
            }
            return resolve();
          } else {
            logger.info('+-> System is in maintenance or last maintenance operation has failed :', _.pick(maintenanceInfo, ['progress', 'state', 'completedAt', 'reason', 'toVersion', 'fromVersion', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']));
            const currTime = moment();
            const maintenanceStartTime = _.get(maintenanceInfo, 'createdAt');
            if (maintenanceStartTime && currTime.diff(maintenanceStartTime) > config.scheduler.maintenance_mode_time_out) {
              logger.warn(`System in maintenance since ${maintenanceInfo.createdAt}. Exceeds configured maintenance timeout. Flagging the current maintenance window as aborted.`);
              const success = resolve;
              return maintenanceManager
                .updateMaintenace(`System in maintenance beyond configured timeout time ${config.scheduler.maintenance_mode_time_out/1000/60} (mins)`,
                  CONST.OPERATION.ABORTED,
                  CONST.SYSTEM_USER)
                .then(success)
                .catch((err) => {
                  logger.error('error occurred while updating maintenance info', err);
                  reject(err);
                })
                .finally(() => {
                  if (this.intervalTimer) {
                    clearInterval(this.intervalTimer);
                  }
                });
            }
            if (this.intervalTimer === undefined) {
              logger.info(`Poll maintenance status once every - ${config.scheduler.maintenance_check_interval} (ms)`);
              this.intervalTimer = setInterval(() => checkMaintenanceStatus.call(this, resolve, reject),
                config.scheduler.maintenance_check_interval);
              return;
            }
          }
        })
        .catch(err => reject(err));
    };
    return new Promise((resolve, reject) => {
      checkMaintenanceStatus.call(this, resolve, reject);
    });
  }

  ensureSystemNotInMainenanceThenInitMaster() {
    logger.info('checking if system in maintenance...');
    return this
      .pollMaintenanceStatus()
      .then(() => this.initMaster())
      .catch(err => {
        logger.error('Error occurred while checking maintenance / init. Scheduler will exit shortly..', err);
        setTimeout(() => process.exit(CONST.ERR_CODES.INTERNAL_ERROR), CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME);
      });
  }

  processUnhandledRejection(reason, p) {
    logger.error(`Unhandled Rejection in - ${this.workerType} - at:`, p, 'reason:', reason);
    if (reason && reason instanceof errors.DBUnavailable) {
      logger.error('DB unavailable. shutting down app');
      this.shutDown();
    } else {
      logger.error('Unhandled Rejection at:', p, 'reason:', reason);
    }
  }

  unhook() {
    //Used primarily from tests
    process.removeListener('SIGTERM', this.shutDownHook);
    process.removeListener('SIGINT', this.shutDownHook);
    process.removeListener('unhandledRejection', this.unhandleRejectionHook);
  }
}

module.exports = new JobScheduler();