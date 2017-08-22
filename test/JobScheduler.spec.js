'use strict';
const proxyquire = require('proxyquire');
const pubsub = require('pubsub-js');
const CONST = require('../lib/constants');
const maintenanceManager = require('../lib/maintenance').maintenanceManager;

const logger = require('../lib/logger');

describe('JobScheduler', function () {
  let JobScheduler;
  let cpus = 0,
    count = 0,
    workers = [];

  function on(event, callback) {
    workers[0] = callback;
  }

  const proxyLibs = {
    'os': {
      cpus: () => ({
        length: cpus
      })
    },
    'cluster': {
      isMaster: true,
      on: on,
      fork: () => {
        count++;
        logger.info('forking child..', count);
        proxyquire('../JobScheduler', {
          'cluster': {
            isMaster: false,
            on: on,
            worker: {
              id: count
            }
          },
          './lib/config': {
            scheduler: {
              max_workers: 5
            }
          }
        });
        return count;
      }
    },
    './lib/config': {
      scheduler: {
        max_workers: 5
      }
    }
  };

  describe('#Start', function () {
    /* jshint expr:true */
    let publishStub, sandbox, clock, maintenaceManagerStub;
    before(function () {
      sandbox = sinon.sandbox.create();
      publishStub = sandbox.stub(pubsub, 'publish');
      maintenaceManagerStub = sandbox.stub(maintenanceManager, 'getMaintenaceInfo', () => Promise.resolve(null));
      clock = sinon.useFakeTimers();
    });

    afterEach(function () {
      publishStub.reset();
      maintenaceManagerStub.reset();
      clock.reset();
    });

    after(function () {
      publishStub.restore();
      clock.restore();
      sandbox.restore();
    });

    it('Should initialize JobScheduler based on CPU Count when max_worker config is greater than # of CPUs', function (done) {
      count = 0;
      logger.info('count is', count);
      cpus = 4;
      JobScheduler = proxyquire('../JobScheduler', proxyLibs);
      return JobScheduler
        .then(() => {
          logger.info('count is>>', count);
          clock.tick(0);
          const EXPECTED_NUM_OF_WORKERS = 4 - 1;
          //Fork should be invoked 1 less than number of cpus.
          for (let x = 0; x < EXPECTED_NUM_OF_WORKERS; x++) {
            clock.tick(0);
          }
          setTimeout(() => {
            expect(count).to.eql(4 - 1);
            done();
          }, 0);
          clock.tick(0);
        });
    });

    it('Create workers based on max_worker config & on error recreate the worker', function (done) {
      count = 0;
      cpus = 8;
      JobScheduler = proxyquire('../JobScheduler', proxyLibs);
      return JobScheduler
        .then(() => {
          for (let x = 0; x < 5; x++) {
            clock.tick(0);
          }
          workers[0]({
            id: 1
          }, 2, null);
          clock.tick(0);
          //Simulate kill one of the workers by invoking the exit handler callback.
          setTimeout(() => {
            logger.info('recreate test is complete.');
            expect(count).to.eql(6);
            //Fork should be invoked based on max_workers in config
            //In the above case because callback also results in additional call
            done();
          }, 0);
          clock.tick(0);
        });
    });

    it('Should publish APP_SHUTDOWN event on recieving SIGINT/SIGTERM', function (done) {
      count = 0;
      cpus = 1;
      let notifyShutDown;
      const processStub = sandbox.stub(process, 'on', (name, callback) => {
        if (name === 'SIGTERM' || name === 'SIGINT') {
          notifyShutDown = callback;
        }
      });
      JobScheduler = proxyquire('../JobScheduler', proxyLibs);
      return JobScheduler
        .then(() => {
          clock.tick(0);
          processStub.restore();
          notifyShutDown();
          setTimeout(() => {
            expect(publishStub).to.be.calledOnce;
            expect(publishStub.firstCall.args[0]).to.eql(CONST.TOPIC.APP_SHUTTING_DOWN);
            expect(count).to.eql(1);
            //Fork should be invoked 1 less than number of cpus.
            done();
          }, 0);
          clock.tick(0);
        });
    });

  });
});