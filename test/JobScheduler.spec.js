'use strict';
const _ = require('lodash');
const proxyquire = require('proxyquire');
const pubsub = require('pubsub-js');
const moment = require('moment');
const CONST = require('../lib/constants');
const errors = require('../lib/errors');
const maintenanceManager = require('../lib/maintenance').maintenanceManager;
const logger = require('../lib/logger');

describe('JobScheduler', function () {
  /* jshint expr:true */
  process.setMaxListeners(0);
  let JobScheduler;
  let cpus = 0,
    count = 0,
    workerExitHandlers = [],
    throwUnhandledError,
    workers = [];

  function on(event, callback) {
    workerExitHandlers[0] = callback;
  }

  const schedulerConfig = {
    max_workers: 5,
    start_delay: 0,
    maintenance_check_interval: 9000,
    maintenance_mode_time_out: 1800000
  };

  let JobWorkers = [];
  const proxyLibs = {
    'os': {
      cpus: () => ({
        length: cpus
      })
    },
    'cluster': {
      isMaster: true,
      on: on,
      workers: workers,
      fork: () => {
        count++;
        logger.info('forking child..', count);
        const js = proxyquire('../JobScheduler', {
          'cluster': {
            isMaster: false,
            on: on,
            worker: {
              id: count
            }
          },
          './lib/config': {
            scheduler: {
              max_workers: 5,
              start_delay: 0
            }
          }
        });
        const worker = {
          pid: count,
          send: (msg) => js.handleMessage(msg)
        };
        workers.push(worker);
        JobWorkers.push(js);
        return count;
      }
    },
    './lib/config': {
      scheduler: schedulerConfig
    }
  };

  after(function () {
    logger.info('unhooking all workers... cleaning up..!');
    _.each(JobWorkers, (worker) => worker.unhook());
  });

  describe('#Start', function () {
    let publishStub, sandbox, clock, processExitStub;
    before(function () {
      sandbox = sinon.sandbox.create();
      publishStub = sandbox.stub(pubsub, 'publish');
      processExitStub = sandbox.stub(process, 'exit');
      clock = sinon.useFakeTimers(new Date().getTime());
    });
    afterEach(function () {
      publishStub.reset();
      processExitStub.reset();
      workers.splice(0, workers.length);
      clock.reset();
    });
    after(function () {
      clock.restore();
      sandbox.restore();
    });

    describe('#NotInMaintenance', function () {
      let maintenaceManagerStub;
      before(function () {
        maintenaceManagerStub = sandbox.stub(maintenanceManager, 'getMaintenaceInfo', () => Promise.resolve(null));
      });
      afterEach(function () {
        maintenaceManagerStub.reset();
      });
      after(function () {
        maintenaceManagerStub.restore();
      });

      it('Should initialize JobScheduler based on CPU Count when max_worker config is greater than # of CPUs', function () {
        count = 0;
        logger.info('count is', count);
        cpus = 4;
        JobScheduler = proxyquire('../JobScheduler', proxyLibs);
        const js = JobScheduler
          .ready
          .then(() => {
            logger.info('count is>>', count);
            clock.tick(0);
            const EXPECTED_NUM_OF_WORKERS = 4 - 1;
            //Fork should be invoked 1 less than number of cpus.
            for (let x = 0, delay = 0; x < EXPECTED_NUM_OF_WORKERS; x++, delay += CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY) {
              clock.tick(delay);
            }
            return Promise.try(() => {
              expect(count).to.eql(4 - 1);
              JobScheduler.unhook();
            });
          });
        clock.tick(schedulerConfig.start_delay);
        return js;
      });
      it('Create workers based on max_worker config & on error recreate the worker', function () {
        count = 0;
        cpus = 8;
        JobScheduler = proxyquire('../JobScheduler', proxyLibs);
        const EXPECTED_NUM_OF_WORKERS = schedulerConfig.max_workers;
        const js = JobScheduler
          .ready
          .then(() => {
            for (let x = 0, delay = 0; x < EXPECTED_NUM_OF_WORKERS; x++, delay += CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY) {
              clock.tick(delay);
            }
            workerExitHandlers[0]({
              id: 1
            }, 2, null);
            clock.tick(CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY);
            //Simulate kill one of the workers by invoking the exit handler callback.
            return Promise.try(() => {
              expect(count).to.eql(6);
              //Fork should be invoked based on max_workers in config
              //In the above case because callback also results in additional call
              JobScheduler.unhook();
            });
          });
        clock.tick(schedulerConfig.start_delay);
        return js;
      });
      it('Should handled unhandled rejection and if the reason is DB unavailable, then must terminate self', function () {
        count = 0;
        cpus = 1;
        throwUnhandledError = true;
        const EXPECTED_NUM_OF_WORKERS = cpus;
        JobScheduler = proxyquire('../JobScheduler', proxyLibs);
        const js = JobScheduler
          .ready
          .then(() => {
            clock.tick(0);
            for (let x = 0, delay = 0; x < EXPECTED_NUM_OF_WORKERS; x++, delay += CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY) {
              clock.tick(delay);
            }
            logger.info('count is>>', count);
            expect(count).to.eql(1);
            JobScheduler.processUnhandledRejection(new errors.DBUnavailable('DB Down ...Simulated expected error ...'));
            clock.tick(CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME);
            expect(publishStub).to.be.calledOnce;
            expect(publishStub.firstCall.args[0]).to.eql(CONST.TOPIC.APP_SHUTTING_DOWN);
            expect(processExitStub).to.be.calledOnce;
            expect(processExitStub.firstCall.args[0]).to.eql(2);
            JobScheduler.handleMessage('INVALID_MESSAGE');
            //Nothing should be done when an invalid message is sent.
            JobScheduler.unhook();
          });
        clock.tick(schedulerConfig.start_delay);
        return js;
      });
      it('workers should exit on system being in maintenance & scheduler must poll till system in maintenance', function () {
        count = 0;
        cpus = 8;
        const EXPECTED_NUM_OF_WORKERS = schedulerConfig.max_workers;
        JobScheduler = proxyquire('../JobScheduler', proxyLibs);
        const js = JobScheduler
          .ready
          .then(() => {
            for (let x = 0, delay = 0; x < EXPECTED_NUM_OF_WORKERS; x++, delay += CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY) {
              clock.tick(delay);
            }
            workerExitHandlers[0]({
              id: 1
            }, CONST.ERR_CODES.SF_IN_MAINTENANCE, null);
            //Simulate kill one of the workers by invoking the exit handler callback & flag that system is in maintenance.
            Promise.try(() => {
              expect(count).to.eql(5);
              expect(JobScheduler.workerCount).to.eql(0);
              logger.info('All jobs are created & are destroyed after putting system in maintenance', JobScheduler.workerCount);
              //All workers should be stopped & system should be in maintenance
            });
            //After all the Jobs are killed, check for maintenance window.
            clock.tick(schedulerConfig.maintenance_check_interval);
            return Promise.try(() => {})
              .then(() => Promise.try(() => {}))
              .then((maintinfo) => {
                //Double Promise.try in the above induces the required lag for the actual maintenace check in JobScheduler, which runs in a promise.
                logger.info('maintenance info as seen in test', maintinfo);
                for (let x = 0, delay = 0; x < EXPECTED_NUM_OF_WORKERS; x++, delay += CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY) {
                  clock.tick(delay);
                }
                //count - indicates how many workers were created.
                logger.debug('recreated all workers...');
                expect(JobScheduler.workerCount).to.eql(5);
                JobScheduler.unhook();
              });
          });
        clock.tick(schedulerConfig.start_delay);
        return js;
      });
    });

    describe('#InMaintenance', function () {
      let getMaintenanceStub, updateMaintStub, updateStatus;
      beforeEach(function () {
        getMaintenanceStub = sandbox.stub(maintenanceManager, 'getMaintenaceInfo');
        updateMaintStub = sandbox.stub(maintenanceManager, 'updateMaintenace', () => {
          return Promise.try(() => {
            if (updateStatus) {
              return {};
            }
            throw new Error('DB Update Failed...');
          });
        });
        getMaintenanceStub.onCall(0).returns(Promise.resolve({
          createdAt: new Date()
        }));
        getMaintenanceStub.onCall(1).returns(Promise.resolve({
          createdAt: new Date()
        }));
        getMaintenanceStub.returns(Promise.resolve(null));
      });
      afterEach(function () {
        getMaintenanceStub.restore();
        updateMaintStub.restore();
      });

      it('JobScheduler starts, waits for system to come out of maintenance & then initializes all workers', function () {
        count = 0;
        logger.info('count is', count);
        cpus = 1;
        JobScheduler = proxyquire('../JobScheduler', proxyLibs);
        const jb = JobScheduler
          .ready
          .then(() => {
            logger.info('count is>>', count);
            clock.tick(0);
            expect(count).to.eql(1);
            JobScheduler.unhook();
          });
        clock.tick(schedulerConfig.start_delay);
        return Promise.try(() => {}).then(() => {
          clock.tick(schedulerConfig.maintenance_check_interval);
          clock.tick(schedulerConfig.maintenance_check_interval);
          return jb;
        });
      });
      it('If maintenance duration exceeds timeout, then terminates maintenance window & on success, initializes all workers', function () {
        getMaintenanceStub.onCall(2).returns(Promise.resolve({
          createdAt: moment().subtract(schedulerConfig.maintenance_mode_time_out)
        }));
        count = 0;
        logger.info('count is', count);
        cpus = 1;
        updateStatus = true;
        JobScheduler = proxyquire('../JobScheduler', proxyLibs);
        const jb = JobScheduler
          .ready
          .then(() => {
            logger.info('count is>>>>', count);
            clock.tick(CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME);
            expect(getMaintenanceStub.callCount).to.equal(3); // 3times from the JobScheduler
            expect(updateMaintStub).to.be.calledOnce;
            expect(updateMaintStub.firstCall.args[0]).to.eql(`System in maintenance beyond configured timeout time ${schedulerConfig.maintenance_mode_time_out/1000/60} (mins)`);
            expect(updateMaintStub.firstCall.args[1]).to.eql(CONST.OPERATION.ABORTED);
            expect(updateMaintStub.firstCall.args[2]).to.eql(CONST.SYSTEM_USER);
            expect(processExitStub).not.to.be.called;
            expect(count).to.eql(1);
            JobScheduler.unhook();
          });
        clock.tick(schedulerConfig.start_delay);
        return Promise.try(() => {}).then(() => {
          clock.tick(schedulerConfig.maintenance_check_interval);
          clock.tick(schedulerConfig.maintenance_check_interval);
          return jb;
        });
      });
      it('If maintenance duration exceeds timeout & if it cannot update maintenance window, then exits the process', function () {
        getMaintenanceStub.onCall(2).returns(Promise.resolve({
          createdAt: moment().subtract(schedulerConfig.maintenance_mode_time_out)
        }));
        count = 0;
        logger.info('count is', count);
        cpus = 1;
        updateStatus = false;
        JobScheduler = proxyquire('../JobScheduler', proxyLibs);
        const jb = JobScheduler
          .ready
          .then(() => {
            logger.info('count is>>>>', count);
            JobScheduler.addJobWorker();
            //When in maintenance mode invoking addJobWorker will not create the worker.
            expect(JobScheduler.workerCount).to.eql(0);
            clock.tick(CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME);
            expect(getMaintenanceStub.callCount).to.equal(3); // 3times from the JobScheduler & 1 from test.
            expect(processExitStub).to.have.been.calledOnce;
            expect(processExitStub.firstCall.args[0]).to.eql(CONST.ERR_CODES.INTERNAL_ERROR);
            expect(count).to.eql(0);
            JobScheduler.unhook();
          });
        clock.tick(schedulerConfig.start_delay);
        return Promise.try(() => {}).then(() => {
          clock.tick(schedulerConfig.maintenance_check_interval);
          clock.tick(schedulerConfig.maintenance_check_interval);
          return jb;
        });
      });
    });
  });

  describe('#Shutdown', function () {
    let processOnStub, sandbox, publishStub, maintenaceManagerStub, clock, processExitStub;
    let eventHandlers = {};
    let sigIntHandler;
    let sigTermHandler;
    before(function () {
      sandbox = sinon.sandbox.create();
      maintenaceManagerStub = sandbox.stub(maintenanceManager, 'getMaintenaceInfo', () => Promise.resolve(null));
      processExitStub = sandbox.stub(process, 'exit');
      processOnStub = sandbox.stub(process, 'on', (name, callback) => {
        eventHandlers[name] = callback;
        if (name === 'SIGINT') {
          logger.info('int handler...');
          sigIntHandler = callback;
        }
        if (name === 'SIGTERM') {
          logger.info('term handler...');
          sigTermHandler = callback;
        }
      });
      publishStub = sandbox.stub(pubsub, 'publish');
      clock = sinon.useFakeTimers(new Date().getTime());
    });
    afterEach(function () {
      eventHandlers = {};
    });
    after(function () {
      sandbox.restore();
      clock.restore();
    });
    it('Should publish APP_SHUTDOWN event on recieving SIGINT/SIGTERM', function () {
      count = 0;
      cpus = 1;
      JobScheduler = proxyquire('../JobScheduler', proxyLibs);
      const js = JobScheduler
        .ready
        .then(() => {
          clock.tick(0);
          logger.info('calling int handler');
          sigIntHandler('a');
          logger.info('calling term handler');
          sigTermHandler('b');
          return Promise.try(() => {
            expect(publishStub).to.be.calledTwice;
            expect(publishStub.firstCall.args[0]).to.eql(CONST.TOPIC.APP_SHUTTING_DOWN);
            expect(publishStub.secondCall.args[0]).to.eql(CONST.TOPIC.APP_SHUTTING_DOWN);
            expect(count).to.eql(1);
            //Fork should be invoked 1 less than number of cpus.
            JobScheduler.unhook();
          });
        });
      clock.tick(schedulerConfig.start_delay);
      return js;
    });
  });
});