'use strict';
const _ = require('lodash');
const proxyquire = require('proxyquire');
const pubsub = require('pubsub-js');
const moment = require('moment');
const CONST = require('../../common/constants');
const config = require('../../common/config');
const errors = require('../../common/errors');
const maintenanceManager = require('../../broker/lib/maintenance').maintenanceManager;
const serviceFabrikClient = require('../../data-access-layer/cf').serviceFabrikClient;
const logger = require('../../common/logger');

describe('JobScheduler', function () {
  /* jshint expr:true */
  process.setMaxListeners(0);
  let JobScheduler;
  let cpus = 0,
    count = 0,
    workerExitHandlers = [],
    throwUnhandledError,
    workers = {};

  function on(event, callback) {
    workerExitHandlers[0] = callback;
  }

  const schedulerConfig = {
    max_workers: 5,
    start_delay: 0,
    maintenance_check_interval: 9000,
    maintenance_mode_time_out: 1800000,
    downtime_maintenance_phases: [
      'BROKER_DRAIN_INITIATED',
      'BROKER_REGISTRATION',
      'UPDATE_SF_MONGODB'
    ]
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
        const js = proxyquire('../../broker/JobScheduler', {
          'cluster': {
            isMaster: false,
            on: on,
            worker: {
              id: count
            }
          },
          '../common/config': {
            scheduler: {
              max_workers: 5,
              start_delay: 0,
              downtime_maintenance_phases: [
                'BROKER_DRAIN_INITIATED',
                'BROKER_REGISTRATION',
                'UPDATE_SF_MONGODB'
              ]
            }
          }
        });
        const worker = {
          pid: count,
          id: count,
          send: (msg) => js.handleMessage(msg)
        };
        workers[count] = worker;
        JobWorkers.push(js);
        return worker;
      }
    },
    '../common/config': {
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
      clock = sinon.useFakeTimers(new Date().getTime());
    });
    beforeEach(function () {
      processExitStub = sandbox.stub(process, 'exit');
    });
    afterEach(function () {
      publishStub.reset();
      processExitStub.reset();
      processExitStub.restore();
      for (let attr in workers) {
        if (workers.hasOwnProperty(attr)) {
          delete workers[attr];
        }
      }
      clock.reset();
    });
    after(function () {
      clock.restore();
      sandbox.restore();
    });

    describe('#NotInMaintenance', function () {
      let maintenaceManagerStub;
      before(function () {
        maintenaceManagerStub = sandbox.stub(maintenanceManager, 'getLastMaintenaceState', () => Promise.resolve({
          createdAt: new Date(),
          updatedAt: new Date(),
          state: CONST.OPERATION.SUCCEEDED
        }));
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
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
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
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
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
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
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
      it('workers should exit on system being in maintenance & scheduler must shut all workers & exit gracefully', function () {
        count = 0;
        cpus = 8;
        const EXPECTED_NUM_OF_WORKERS = schedulerConfig.max_workers;
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
        const js = JobScheduler
          .ready
          .then(() => {
            for (let x = 0, delay = 0; x < EXPECTED_NUM_OF_WORKERS; x++, delay += CONST.JOB_SCHEDULER.WORKER_CREATE_DELAY) {
              clock.tick(delay);
            }
            delete workers[1];
            //ensure that key is removed from workers as its going to be terminated
            workerExitHandlers[0]({
              id: 1
            }, CONST.ERR_CODES.SF_IN_MAINTENANCE, null);
            workerExitHandlers[0]({
              id: 1
            }, 2, null);
            //Should ignore any other exit signals recieved while in maintenance
            //Simulate kill one of the workers by invoking the exit handler callback & flag that system is in maintenance.
            expect(count).to.eql(5);
            for (let x = 0; x < EXPECTED_NUM_OF_WORKERS - 1; x++) {
              clock.tick(CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME);
            }
            clock.tick(CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME * EXPECTED_NUM_OF_WORKERS);
            //count - indicates how many workers were created.
            expect(processExitStub.callCount).to.equal(5); //4 from workers and 1 from main scheduler.
            expect(JobScheduler.workerCount).to.eql(4); //4 workers because 1 is removed from the seccond exit handler which sends exit code:2
            JobScheduler.unhook();
          });
        clock.tick(schedulerConfig.start_delay);
        return js;
      });
    });

    describe('#MaintenanceStateNotDetermined', function () {
      let getMaintenanceStub;
      before(function () {
        getMaintenanceStub = sandbox.stub(maintenanceManager, 'getLastMaintenaceState', () => {
          return Promise.try(() => {
            throw new Error('Error occurred while fetching maintenance state...');
          });
        });
      });
      afterEach(function () {
        getMaintenanceStub.reset();
      });
      after(function () {
        getMaintenanceStub.restore();
      });
      it('JobScheduler starts & if it cannot fetch maintenance window info, then exits the process', function () {
        count = 0;
        logger.info('count is', count);
        cpus = 1;
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
        const jb = JobScheduler
          .ready
          .then(() => {
            logger.info('count is>>', count);
            expect(processExitStub).not.to.be.called;
            clock.tick(CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME);
            JobScheduler.unhook();
          });
        clock.tick(schedulerConfig.start_delay);
        return jb;
      });
    });

    describe('#InMaintenance', function () {
      let getMaintenanceStub, updateMaintStub, updateStatus, sfClientStub;
      let sfConnectedToDB = true,
        sfIsDown = false;
      before(function () {
        sfClientStub = sandbox.stub(serviceFabrikClient, 'getInfo', () => {
          return Promise.try(() => {
            if (sfIsDown) {
              throw new Error('Service Fabrik unreachable');
            }
            const sfState = {
              name: 'service-fabrik-broker',
              api_version: '1.0',
              ready: true,
              db_status: CONST.DB.STATE.DISCONNECTED
            };
            if (sfConnectedToDB) {
              return _.chain(sfState)
                .clone()
                .set('db_status', CONST.DB.STATE.CONNECTED)
                .value();
            }
            return sfState;
          });
        });
      });
      beforeEach(function () {
        sfIsDown = false;
        sfConnectedToDB = true;
        getMaintenanceStub = sandbox.stub(maintenanceManager, 'getLastMaintenaceState');
        updateMaintStub = sandbox.stub(maintenanceManager, 'updateMaintenace', () => {
          return Promise.try(() => {
            if (updateStatus) {
              return {};
            }
            throw new Error('DB Update Failed...');
          });
        });
        getMaintenanceStub.onCall(0).returns(Promise.resolve({
          createdAt: new Date(),
          progress: [`${config.broker_drain_message}}`],
          broker_update_initiated: true,
          state: CONST.OPERATION.IN_PROGRESS
        }));
        getMaintenanceStub.onCall(1).returns(Promise.resolve({
          createdAt: new Date(),
          progress: [`${config.broker_drain_message} at ${new Date()}`],
          broker_update_initiated: true,
          state: CONST.OPERATION.IN_PROGRESS
        }));
        getMaintenanceStub.returns(Promise.resolve({
          createdAt: new Date(),
          state: CONST.OPERATION.SUCCEEDED
        }));
      });
      afterEach(function () {
        getMaintenanceStub.restore();
        updateMaintStub.restore();
        sfClientStub.reset();
      });
      after(function () {
        sfClientStub.restore();
      });

      it('JobScheduler starts, waits for system to come out of maintenance & then initializes all workers', function () {
        count = 0;
        logger.info('count is', count);
        cpus = 1;
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
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
      it('on checking maintenance state if broker update is not in progress, it initializes all workers & scheduler starts', function () {
        count = 0;
        getMaintenanceStub.onCall(0).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS,
          progress: [`Docker update in progress at ${new Date()}`],
          createdAt: moment().subtract(schedulerConfig.maintenance_mode_time_out),
          updatedAt: moment().subtract(schedulerConfig.maintenance_mode_time_out)
        }));
        logger.info('count is', count);
        cpus = 1;
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
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
          return jb;
        });
      });
      it('If maintenance duration exceeds timeout, then terminates maintenance window. On successful abort & on SF being connected to DB, initializes all workers', function () {
        sfIsDown = true;
        getMaintenanceStub.onCall(2).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS,
          progress: [`${config.broker_drain_message} at ${moment().subtract(schedulerConfig.maintenance_mode_time_out)}`],
          createdAt: moment().subtract(schedulerConfig.maintenance_mode_time_out),
          updatedAt: moment().subtract(schedulerConfig.maintenance_mode_time_out)
        }));
        getMaintenanceStub.onCall(3).returns(Promise.resolve({
          state: CONST.OPERATION.ABORTED,
          createdAt: moment().subtract(schedulerConfig.maintenance_mode_time_out),
          updatedAt: moment().subtract(schedulerConfig.maintenance_mode_time_out)
        }));
        count = 0;
        logger.info('count is', count);
        cpus = 1;
        updateStatus = true;
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
        const jb = JobScheduler
          .ready
          .then(() => {
            logger.info('count is>>>>', count);
            clock.tick(0);
            expect(getMaintenanceStub.callCount).to.equal(4); // 4times from the JobScheduler
            expect(updateMaintStub).to.be.calledOnce;
            expect(updateMaintStub.firstCall.args[0]).to.eql(`System in maintenance beyond configured timeout time ${schedulerConfig.maintenance_mode_time_out / 1000 / 60} (mins). JobScheduler aborting it.`);
            expect(updateMaintStub.firstCall.args[1]).to.eql(CONST.OPERATION.ABORTED);
            expect(updateMaintStub.firstCall.args[2]).to.eql(CONST.SYSTEM_USER);
            clock.tick(CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME);
            expect(processExitStub).to.be.called;
            expect(count).to.eql(0);
            JobScheduler.unhook();
          });
        clock.tick(schedulerConfig.start_delay);
        return Promise.try(() => {}).then(() => {
          clock.tick(schedulerConfig.maintenance_check_interval);
          clock.tick(schedulerConfig.maintenance_check_interval);
          clock.tick(schedulerConfig.maintenance_check_interval);
          return jb;
        });
      });
      it('If maintenance duration exceeds timeout, then terminates maintenance window. If service fabrik status cant be determined then terminates itself.', function () {
        getMaintenanceStub.onCall(2).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS,
          progress: [`${config.broker_drain_message} at ${moment().subtract(schedulerConfig.maintenance_mode_time_out)}`],
          createdAt: moment().subtract(schedulerConfig.maintenance_mode_time_out),
          updatedAt: moment().subtract(schedulerConfig.maintenance_mode_time_out)
        }));
        getMaintenanceStub.onCall(3).returns(Promise.resolve({
          state: CONST.OPERATION.ABORTED,
          createdAt: moment().subtract(schedulerConfig.maintenance_mode_time_out),
          updatedAt: new Date()
        }));
        count = 0;
        logger.info('count is', count);
        cpus = 1;
        updateStatus = true;
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
        const jb = JobScheduler
          .ready
          .then(() => {
            logger.info('count is>>>>', count);
            clock.tick(0);
            expect(getMaintenanceStub.callCount).to.equal(4); // 4times from the JobScheduler
            expect(updateMaintStub).to.be.calledOnce;
            expect(updateMaintStub.firstCall.args[0]).to.eql(`System in maintenance beyond configured timeout time ${schedulerConfig.maintenance_mode_time_out / 1000 / 60} (mins). JobScheduler aborting it.`);
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
          clock.tick(schedulerConfig.maintenance_check_interval);
          return jb;
        });
      });
      it('If maintenance duration exceeds timeout, then terminates maintenance window. If SF is not connected to DB then continues polling', function () {
        sfConnectedToDB = false;
        getMaintenanceStub.onCall(2).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS,
          progress: [`${config.broker_drain_message} at ${moment().subtract(schedulerConfig.maintenance_mode_time_out)}`],
          createdAt: moment().subtract(schedulerConfig.maintenance_mode_time_out),
          updatedAt: moment().subtract(schedulerConfig.maintenance_mode_time_out)
        }));
        getMaintenanceStub.onCall(3).returns(Promise.resolve({
          state: CONST.OPERATION.ABORTED,
          createdAt: moment().subtract(schedulerConfig.maintenance_mode_time_out),
          updatedAt: new Date()
        }));
        count = 0;
        logger.info('count is', count);
        cpus = 1;
        updateStatus = true;
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
        const jb = JobScheduler
          .ready
          .then(() => {
            logger.info('count is>>>>', count);
            clock.tick(CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME);
            expect(getMaintenanceStub.callCount).to.equal(5); // 4times from the JobScheduler
            expect(updateMaintStub).to.be.calledOnce;
            expect(updateMaintStub.firstCall.args[0]).to.eql(`System in maintenance beyond configured timeout time ${schedulerConfig.maintenance_mode_time_out / 1000 / 60} (mins). JobScheduler aborting it.`);
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
          clock.tick(schedulerConfig.maintenance_check_interval);
          clock.tick(schedulerConfig.maintenance_check_interval);
          return jb;
        });
      });
      it('If maintenance duration exceeds timeout & if it cannot update maintenance window, then exits the process', function () {
        getMaintenanceStub.onCall(1).returns(Promise.resolve({
          state: CONST.OPERATION.IN_PROGRESS,
          progress: [`${config.broker_drain_message} at ${moment().subtract(schedulerConfig.maintenance_mode_time_out)}`],
          createdAt: moment().subtract(schedulerConfig.maintenance_mode_time_out),
          updatedAt: moment().subtract(schedulerConfig.maintenance_mode_time_out)
        }));
        count = 0;
        logger.info('count is', count);
        cpus = 1;
        updateStatus = false;
        JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
        const jb = JobScheduler
          .ready
          .then(() => {
            logger.info('count is>>>>', count);
            JobScheduler.addJobWorker();
            //When in maintenance mode invoking addJobWorker will not create the worker.
            expect(JobScheduler.workerCount).to.eql(0);
            clock.tick(CONST.JOB_SCHEDULER.SHUTDOWN_WAIT_TIME);
            expect(getMaintenanceStub.callCount).to.equal(2); // 3times from the JobScheduler & 1 from test.
            expect(processExitStub).to.have.been.calledOnce;
            expect(processExitStub.firstCall.args[0]).to.eql(CONST.ERR_CODES.INTERNAL_ERROR);
            expect(count).to.eql(0);
            JobScheduler.unhook();
          });
        clock.tick(schedulerConfig.start_delay);
        return Promise.try(() => {}).then(() => {
          clock.tick(schedulerConfig.maintenance_check_interval);
          return jb;
        });
      });
    });
  });

  describe('#Shutdown', function () {
    let processOnStub, sandbox, publishStub, maintenaceManagerStub, clock, processExitStub;
    let eventHandlers = {};
    let sigIntHandler, sigTermHandler, unhandledRejectHandler, messageHandler;
    before(function () {
      sandbox = sinon.sandbox.create();
      maintenaceManagerStub = sandbox.stub(maintenanceManager, 'getLastMaintenaceState', () => Promise.resolve(null));
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
        if (name === 'unhandledRejection') {
          unhandledRejectHandler = callback;
        }
        if (name === 'message') {
          messageHandler = callback;
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
      JobScheduler = proxyquire('../../broker/JobScheduler', proxyLibs);
      const js = JobScheduler
        .ready
        .then(() => {
          clock.tick(0);
          messageHandler('c');
          sigIntHandler('a');
          sigTermHandler('b');
          unhandledRejectHandler('Simulated Rejection...');
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