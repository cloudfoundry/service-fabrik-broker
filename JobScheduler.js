'use strict';

const _ = require('lodash');
const pubsub = require('pubsub-js');
const cluster = require('cluster');
const moment = require('moment');
const cpus = require('os').cpus();
const CONST = require('./lib/constants');
const logger = require('./lib/logger');
const config = require('./lib/config');
const errors = require('./lib/errors');
const maintenanceManager = require('./lib/maintenance').maintenanceManager;

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
    return Promise.try(() => {
      this.jobWorkers = [];
      this.workerCount = 0;
      this.workerType = '';
      this.serviceFabrikInMaintenance = false;
      this.intervalTimer = undefined;
      this.maintenanceStartTime = undefined;
      process.on('SIGTERM', () => this.notifyShutDown());
      process.on('SIGINT', () => this.notifyShutDown());
      process.on('unhandledRejection', (reason, p) => this.processUnhandledRejection(reason, p));
      if (cluster.isMaster) {
        this.maintenanceStartTime = moment(new Date());
        return this.ensureSystemNotInMainenanceThenInitMaster();
      } else {
        return this.initWorker();
      }
    });
  }

  initMaster() {
    logger.info(`Configured number of workers ${config.scheduler.max_workers} - No. of CPUs : ${cpus.length} - job workers : ${maxWorkers}`);
    this.workerType = `MASTER - ${process.pid}`;
    cluster.on('exit', (worker, code, signal) => this.workerExitHandler(worker, code, signal));
    // Create a worker for each CPU
    for (var i = 0, delay = 0; i < maxWorkers; i += 1, delay += CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY) {
      delay = process.env.NODE_ENV === 'test' ? 0 : delay;
      logger.debug(`Set scheduled job worker ${i} with delay ${delay}`);
      //Agenda Scheduler for each worker will be configured to processJobQueue once every ${maxWorkers} minutes.
      //So each worker job is started with a delay of 1 minute, as it creates a constant sliding window of 1 min
      this.addJobWorker();
      // setTimeout(() => this.addJobWorker(), delay);
    }
  }

  initWorker() {
    this.workerType = `Worker - ${cluster.worker.id} - ${process.pid}`;
    logger.info(`Starting Service Fabrik Batch Job worker: ${cluster.worker.id} - ${process.pid}  @${new Date()}`);
    require('./lib/jobs');
    require('./lib/fabrik');
    process.on('message', (msg) => {
      logger.info(`recieved message :${msg} in - ${this.workerType} `);
      if (msg === CONST.TOPIC.APP_SHUTTING_DOWN) {
        pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
        process.kill(2);
      }
    });
  }

  workerExitHandler(worker, code, signal) {
    const createWorkerDelay = process.env.NODE_ENV === 'test' ? 0 : CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME;
    //Individual worker crashes are restarted by cluster itself. Entire process crash is to be handled via MONIT
    logger.error(`exit signal recieved for  Batch Job worker - ${worker.id} - code: ${code} - signal: ${signal}`);
    if (code === CONST.ERR_CODES.SF_IN_MAINTENANCE) {
      this.placeSchedulerInMaintenance();
    }
    setTimeout(() => {
      logger.info(`Batch Job worker :${worker.id} - ${process.pid} shutdown complete`);
      this.removeJobWorker(worker.id);
      this.addJobWorker();
    }, createWorkerDelay);
  }

  placeSchedulerInMaintenance() {
    this.serviceFabrikInMaintenance = true;
    _.each(this.jobWorkers, (id) => {
      logger.info(`message From - ${this.workerType} - To worker - ${cluster.workers[id].pid}`);
      cluster.workers[id].send(CONST.TOPIC.APP_SHUTTING_DOWN);
    });
    this.maintenanceStartTime = moment(new Date());
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

  notifyShutDown() {
    logger.info(`ServiceFabrik Batch Job ${this.workerType} shutting down shortly...`);
    pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
    const waitBeforeShutdown = process.env.NODE_ENV === 'test' ? 0 : 5000;
    setTimeout(() => {
      logger.info(`ServiceFabrik Batch Job ${this.workerType} shutdown complete`);
      return process.env.NODE_ENV !== 'test' ? process.exit(2) : '';
    }, waitBeforeShutdown);
  }

  ensureSystemNotInMainenanceThenInitMaster() {
    return maintenanceManager
      .getMaintenaceInfo()
      .then(maintenanceInfo => {
        if (maintenanceInfo === null) {
          if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
          }
          this.maintenanceStartTime = undefined;
          logger.info('+-> System is not in maintenance');
          this.initMaster();
        } else {
          if (this.intervalTimer === undefined) {
            this.intervalTimer = setInterval(() => this.checkMaintenance(),
              process.env.NODE_ENV !== 'test' ?
              config.scheduler.maintenance_check_interval : 0);
          }
          const currTime = moment();
          if (currTime.diff(this.maintenanceStartTime) > config.scheduler.maintenance_mode_time_out) {
            logger.warn('System in maintenance beyond configured timeout. Flagging the current maintenance window as aborted.');
            return maintenanceManager
              .updateMaintenace({
                progress: `System in maintenance beyond configured timeout time ${config.scheduler.maintenance_mode_time_out/1000/60} (mins)`,
                state: CONST.OPERATION.ABORTED
              });
          }
          logger.info('System is still in maintenance:', maintenanceInfo);
        }
      });
  }

  processUnhandledRejection(reason, p) {
    if (reason && reason instanceof errors.DBUnavailable) {
      logger.error('DB unavailable. shutting down app');
      this.notifyShutDown();
    } else {
      logger.error('Unhandled Rejection at:', p, 'reason:', reason);
    }
  }
}

module.exports = new JobScheduler();