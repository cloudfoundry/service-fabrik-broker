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
const utils = require('./lib/utils');
const errors = require('./lib/errors');
const maintenanceManager = require('./lib/maintenance').maintenanceManager;
const serviceFabrikClient = require('./lib/cf').serviceFabrikClient;
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
      this.maintenanceStartTime = undefined;
      this.shutDownHook = () => this.shutDown();
      process.on('SIGTERM', this.shutDownHook);
      process.on('SIGINT', this.shutDownHook);
      this.unhandleRejectionHook = (reason, p) => this.processUnhandledRejection(reason, p);
      process.on('unhandledRejection', this.unhandleRejectionHook);
      if (cluster.isMaster) {
        cluster.on('exit', (worker, code, signal) => this.workerExitHandler(worker, code, signal));
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
    this.workerCount = 0;
    this.jobWorkers = [];
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
    process.on('message', (msg) => this.handleMessage(msg));
    logger.info(`Starting Service Fabrik Batch Job worker: ${cluster.worker.id} - ${process.pid}  @${new Date()}`);
    require('./lib/jobs');
    utils.initializeEventListener(config.external, 'external');
  }

  handleMessage(msg) {
    logger.info(`recieved message :${msg} in - ${this.workerType} `);
    if (msg === CONST.TOPIC.APP_SHUTTING_DOWN) {
      this.shutDown();
    }
  }

  workerExitHandler(worker, code, signal) {
    //Individual worker crashes are restarted by cluster itself. Entire process crash is to be handled via MONIT
    logger.error(`exit signal recieved for  Batch Job worker - ${worker.id} - code: ${code} - signal: ${signal}`);
    if (code === CONST.ERR_CODES.SF_IN_MAINTENANCE) {
      logger.info('System is in maintenance, stop all workers');
      this.placeSchedulerInMaintenance();
    } else {
      logger.info(`Batch Job worker :${worker.id} - ${process.pid} shutdown complete`);
      this.removeJobWorker(worker.id);
      if (!this.serviceFabrikInMaintenance) {
        //worker has crashed for other reasons, so just recreate it with delay if sf is not in maintenance.
        setTimeout(() => {
          this.addJobWorker();
        }, CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY);
      }
    }
  }

  placeSchedulerInMaintenance() {
    this.serviceFabrikInMaintenance = true;
    _.each(this.jobWorkers, (id) => {
      if (cluster.workers[id]) {
        logger.info(`+-> Sending message From -> ${this.workerType} - To worker - ${id}`);
        //Dont send message to the same worker which threw the exception as it will be non-existent.
        cluster.workers[id].send(CONST.TOPIC.APP_SHUTTING_DOWN);
      }
    });
    logger.info('Shutting scheduler down due to maintenance...');
    //Shut yourself down (alternatively could have invoked ensureSystemNotInMainenanceThenInitMaster, however
    //if more than one worker process runs and it also identifies that they are in maintenance, then you could have
    //placeSchedulerInMaintenance being called 'n' times. Keeping it simple by shutting down and monit brings it back)
    this.shutDown(CONST.ERR_CODES.SF_IN_MAINTENANCE, this.jobWorkers.length);
  }

  addJobWorker() {
    if (!this.serviceFabrikInMaintenance) {
      this.workerCount++;
      logger.info(`SF not in maintenance, adding worker - ${this.workerCount}`);
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

  shutDown(exitCode, waitFactor) {
    logger.info(`ServiceFabrik Batch Job ${this.workerType} shutting down shortly...`);
    waitFactor = waitFactor || 1;
    exitCode = exitCode || 2;
    pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
    setTimeout(() => {
      logger.info(`ServiceFabrik Batch Job ${this.workerType} shutdown complete`);
      process.exit(exitCode);
    }, CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME * waitFactor);
  }

  pollMaintenanceStatus() {
    this.intervalTimer = this.maintenanceStartTime = undefined;
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
            if (this.intervalTimer === undefined) {
              logger.info(`Poll maintenance status once every - ${config.scheduler.maintenance_check_interval} (ms)`);
              this.intervalTimer = setInterval(() => checkMaintenanceStatus.call(this, resolve, reject),
                config.scheduler.maintenance_check_interval);
            }
            const maintInfoAttrs = ['progress', 'state', 'completedAt', 'reason', 'toVersion', 'fromVersion', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy'];
            if (_.get(maintenanceInfo, 'state', '') !== CONST.OPERATION.IN_PROGRESS) {
              logger.info(`+-> System is not in maintenance, but its current state is: ${_.get(maintenanceInfo, 'state', '')}, not as expected.`);
              logger.info('checking if service fabrik is up, inspite of unexpected maintenance state - ', _.pick(maintenanceInfo, maintInfoAttrs));
              return serviceFabrikClient.getInfo()
                .then(info => {
                  logger.info('Going ahead with starting the scheduler, as SF is up & responding back :-', info);
                  //Ignore DB status as returned from SF as in case of DB update failure it returns back CREATE_UPDATE_FAILED.
                  //However DB would stil be reachable and connected. If DB is down scheduler anyway goes down itslef.
                  clearInterval(this.intervalTimer);
                  return resolve();
                })
                .catch(err => reject('error occurred while fetching service fabrik broker status:', err));
            } else {
              logger.info('+-> System is in maintenance :', _.pick(maintenanceInfo, maintInfoAttrs));
              const downTimePhase = maintenanceManager.getLastDowntimePhase(maintenanceInfo, config.scheduler.downtime_maintenance_phases);
              if (downTimePhase === undefined) {
                logger.info('Current Maintenance phase does not affect scheduler downtime. So going ahead and starting it...');
                clearInterval(this.intervalTimer);
                return resolve();
              }
              logger.info(`Scheduler in downtime phase: ${downTimePhase}, will wait till maintenance state changes from in-progress to completed state`);
              this.maintenanceStartTime = this.maintenanceStartTime || maintenanceInfo.updatedAt;
              const currTime = moment();
              if (this.maintenanceStartTime && currTime.diff(this.maintenanceStartTime) > config.scheduler.maintenance_mode_time_out) {
                logger.warn(`System in maintenance since ${maintenanceInfo.createdAt}. Exceeds configured maintenance timeout  ${config.scheduler.maintenance_mode_time_out} (ms). Flagging the current maintenance window as aborted.`);
                return maintenanceManager
                  .updateMaintenace(`System in maintenance beyond configured timeout time ${config.scheduler.maintenance_mode_time_out/1000/60} (mins). JobScheduler aborting it.`,
                    CONST.OPERATION.ABORTED,
                    CONST.SYSTEM_USER)
                  .then(() => logger.info('JobScheduler Aborted current maintenance window'))
                  .catch((err) => {
                    logger.error('error occurred while aborting maintenance - ', err);
                    clearInterval(this.intervalTimer);
                    reject(err);
                  });
              }
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