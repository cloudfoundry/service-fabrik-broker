'use strict';

const pubsub = require('pubsub-js');
const cluster = require('cluster');
const cpus = require('os').cpus();
const CONST = require('./lib/constants');
const logger = require('./lib/logger');
const config = require('./lib/config');
const errors = require('./lib/errors');

let cpuCount = cpus.length;
let maxWorkers = 0;
let workerCount = 0;
//Assuming broker/jobscheduler are running on same VM, keeping the # jobs 1 less than cpu count. 
cpuCount = cpuCount > 1 ? cpuCount - 1 : 1;
if (config.scheduler.max_workers && config.scheduler.max_workers < cpuCount) {
  maxWorkers = config.scheduler.max_workers;
} else {
  maxWorkers = cpuCount;
}
const jobWorkers = [];
let workerType;
if (cluster.isMaster) {
  logger.info(`Configured number of workers ${config.scheduler.max_workers} - No. of CPUs : ${cpus.length} - job workers : ${maxWorkers}`);
  workerType = `MASTER - ${process.pid}`;
  // Create a worker for each CPU
  for (var i = 0, delay = 0; i < maxWorkers; i += 1, delay += CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY) {
    delay = process.env.NODE_ENV === 'test' ? 0 : delay;
    logger.debug(`Set scheduled job worker ${i} with delay ${delay}`);
    //Agenda Scheduler for each worker will be configured to processJobQueue once every ${maxWorkers} minutes.
    //So each worker job is started with a delay of 1 minute, as it creates a constant sliding window of 1 min
    setTimeout(addJobWorker, delay);
  }
  const createWorkerDelay = process.env.NODE_ENV === 'test' ? 0 : CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME;
  cluster.on('exit', function (worker, code, signal) {
    //Individual worker crashes are restarted by cluster itself. Entire process crash is to be handled via MONIT
    logger.error(`exit signal recieved for  Batch Job worker - ${worker.id} - code: ${code} - signal: ${signal}`);
    pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
    setTimeout(() => {
      logger.info(`Batch Job worker :${worker.id} - ${process.pid} shutdown complete`);
      removeJobWorker(worker.id);
      addJobWorker();
    }, createWorkerDelay);
  });
  process.on('SIGTERM', notifyShutDown);
  process.on('SIGINT', notifyShutDown);
  //https://github.com/nodejs/node-v0.x-archive/issues/5054
} else {
  workerType = `Worker - ${cluster.worker.id} - ${process.pid} `;
  logger.info(`Starting Service Fabrik Batch Job worker: ${cluster.worker.id} - ${process.pid}  @${new Date()}`);
  require('./lib/jobs');
  require('./lib/fabrik');
}

function addJobWorker() {
  workerCount++;
  jobWorkers.push(cluster.fork({
    job: 1,
    worker: workerCount
  }).id);
}

function removeJobWorker(id) {
  jobWorkers.splice(jobWorkers.indexOf(id), 1);
}

function notifyShutDown() {
  logger.info(`ServiceFabrik Batch Job ${workerType} shutting down shortly...`);
  pubsub.publish(CONST.TOPIC.APP_SHUTTING_DOWN);
  const waitBeforeShutdown = process.env.NODE_ENV === 'test' ? 0 : 5000;
  setTimeout(() => {
    logger.info(`ServiceFabrik Batch Job ${workerType} shutdown complete`);
    return process.env.NODE_ENV !== 'test' ? process.exit(2) : '';
  }, waitBeforeShutdown);
}

process.on('unhandledRejection', (reason, p) => {
  if (reason && reason instanceof errors.DBUnavailable) {
    logger.error('DB unavailable. shutting down app');
    notifyShutDown();
  } else {
    logger.error('Unhandled Rejection at:', p, 'reason:', reason);
  }
});