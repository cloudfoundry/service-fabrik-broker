'use strict';

const _ = require('lodash');
var moment = require('moment-timezone');
const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const mongoose = require('mongoose');
const pubsub = require('pubsub-js');
const os = require('os');
var EventEmitter = require('events').EventEmitter;
const CONST = require('../../common/constants');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const BaseJob = require('../../jobs/BaseJob');
const maintenanceManager = require('../../maintenance').maintenanceManager;

const MONGO_INIT_SUCCEEDED = 2;
const MONGO_INIT_FAILED = 1;
const MONGO_TO_BE_INITIALIZED = 0;

const pubSubStub = {
  publish: () => undefined,
  subscribe: () => undefined
};

/* jshint unused: false */
const agendaStub = {
  init: () => undefined,
  on: (event, cb) => undefined,
  processEvery: (ms) => undefined,
  maxConcurrency: (count) => undefined,
  defaultConcurrency: (count) => undefined,
  defaultLockLifetime: (count) => undefined,
  start: () => undefined,
  jobsAsync: () => undefined,
  define: (name, cb) => undefined,
  create: (name, data) => undefined,
  cancelAsync: (criteria) => undefined,
  everyAsync: (interval, jobName, data, options) => undefined,
  scheduleAsync: (runAt, jobName, data) => undefined,
  nowAsync: (jobName, data) => undefined,
  stop: () => undefined
};

const jobStub = {
  attrs: {},
  unique: (data) => undefined,
  repeatEvery: (interval) => undefined,
  computeNextRunAt: () => undefined,
  schedule: () => undefined,
  runAsync: () => {
    return Promise.resolve({});
  },
  saveAsync: () => {
    return Promise.resolve({});
  }
};
let agendaEventHandlers = {};
let agendaJobs = [];
let schedulerStartFailed = false;
class Agenda extends EventEmitter {
  constructor(options) {
    super();
    agendaStub.init(options);
    return this;
  }
  on(event, cb) {
    super.on(event, cb);
    agendaEventHandlers[event] = cb;
    agendaStub.on(event, cb);
    return this;
  }
  processEvery(milliseconds) {
    agendaStub.processEvery(milliseconds);
    return this;
  }
  maxConcurrency(concurrencyCount) {
    agendaStub.maxConcurrency(concurrencyCount);
    return this;
  }
  defaultConcurrency(concurrencyCount) {
    agendaStub.defaultConcurrency(concurrencyCount);
    return this;
  }
  defaultLockLifetime(lockTime) {
    agendaStub.defaultLockLifetime(lockTime);
    return this;
  }
  jobsAsync(options) {
    const jobs = [{
      attrs: {
        name: '1234567890_ScheduledBackup'
      }
    }, {
      attrs: {
        name: '9876543210_ScheduledBackup'
      }
    }];
    agendaStub.jobsAsync(options);
    const jobResponse = {
      attrs: {
        name: options.name,
        data: {
          _n_a_m_e_: '9999-8888-7777-6666_ScheduledBackup',
          instance_id: '9999-8888-7777-6666'
        },
        lastRunAt: new Date(),
        nextRunAt: new Date(),
        repeatInterval: '*/1 * * * *',
        lockedAt: null,
        repeatTimezone: 'America/New_York'
      }
    };
    if (_.keys(options).length === 0) {
      return Promise.resolve(jobs);
    } else {
      if (options['data._n_a_m_e_'].$regex === '^9999-8888-7777-6666_ScheduledBackup.*') {
        return Promise.resolve([jobResponse]);
      } else if (options['data._n_a_m_e_'].$regex === '^9999-8888-7777-7777_ScheduledBackup.*') {
        const jobResp1 = _.cloneDeep(jobResponse);
        jobResp1.attrs.data._n_a_m_e_ = '9999-8888-7777-7777_ScheduledBackup';
        jobResp1.attrs.data.instance_id = '9999-8888-7777-7777';
        jobResp1.attrs.nextRunAt = new Date('01/01/2016');
        const jobResp2 = _.cloneDeep(jobResponse);
        jobResp2.attrs.nextRunAt = new Date(0);
        jobResp2.attrs.data._n_a_m_e_ = `9999-8888-7777-7777_ScheduledBackup_5minsfromnow_${new Date().getTime()}`;
        return Promise.resolve([jobResp1, jobResp2]);
      } else {
        return Promise.resolve({});
      }
    }
  }
  start() {
    agendaStub.start();
    if (schedulerStartFailed) {
      throw new errors.ServiceUnavailable('Error occurred while starting agenda');
    }
  }
  define(name, cb) {
    agendaJobs.push(cb);
    agendaStub.define(name, cb);
    if (schedulerStartFailed) {
      throw new errors.ServiceUnavailable('Error occurred while starting agenda');
    }
  }
  create(name, data) {
    agendaStub.create(name, data);
    return jobStub;
  }
  everyAsync(interval, jobName, data, options) {
    agendaStub.everyAsync(interval, jobName, data, options);
    return Promise.resolve({});
  }
  cancelAsync(criteria) {
    agendaStub.cancelAsync(criteria);
    return Promise.resolve({});
  }
  scheduleAsync(runAt, jobName, data) {
    agendaStub.scheduleAsync(runAt, jobName, data);
    return Promise.resolve({});
  }
  nowAsync(jobName, data) {
    agendaStub.nowAsync(jobName, data);
    return Promise.resolve({});
  }
  stop() {
    agendaStub.stop();
  }
}

const proxyPubSub = {
  publish: function (event, func) {
    return pubSubStub.publish(event, func);
  },
  subscribe: function (event, func) {
    return pubSubStub.subscribe(event, func);
  }
};
const jobTypes = 'ScheduledBackup, ScheduledOobDeploymentBackup';
const schedulerConfig = {
  job_types: jobTypes,
  process_every: '1 minute',
  max_workers: 4,
  max_concurrency: 30,
  default_concurrency: 20,
  default_lock_lifetime: 180000,
  agenda_collection: 'agendaJobDetails',
  job_history_retention_in_days: 1,
  jobs: {
    reschedule_delay: '20 mins from now'
  },
  downtime_maintenance_phases: [
    'BROKER_DRAIN_INITIATED',
    'BROKER_REGISTRATION',
    'UPDATE_SF_MONGODB'
  ]
};
const proxyLibs = {
  'bluebird': {
    promisifyAll: function (list) {
      return;
    }
  },
  'agenda': Agenda,
  '../common/config': {
    scheduler: schedulerConfig,
    mongodb: {
      backup: {
        schedule_interval: '0 12 * * *'
      }
    }
  }
};

const cloneProxyLibs = _.cloneDeep(proxyLibs);
cloneProxyLibs['../common/config'].scheduler = schedulerConfig;
const SchedulerPubSub = proxyquire('../../jobs/Scheduler', cloneProxyLibs);
const Scheduler = proxyquire('../../jobs/Scheduler', _.set(proxyLibs, 'pubsub-js', proxyPubSub));

describe('Jobs', function () {
  let clock;
  before(function () {
    clock = sinon.useFakeTimers(new Date().getTime());
  });
  after(function () {
    clock.restore();
  });
  /* jshint expr:true */
  describe('Scheduler', function () {
    let agendaSpy, subscribeSpy, publishSpy, agendaSpyInit, mongooseConnectionStub, sandbox, jobSpy, logSpy, osCpuStub;
    before(function () {
      sandbox = sinon.sandbox.create();
      mongooseConnectionStub = sandbox.stub(mongoose);
      logSpy = sinon.spy(logger, 'error');
      agendaSpy = sandbox.stub(agendaStub);
      jobSpy = sandbox.stub(jobStub);
      jobSpy.saveAsync.withArgs().returns(Promise.resolve({
        'a': '1'
      }));
      subscribeSpy = sandbox.stub(pubSubStub, 'subscribe');
      publishSpy = sandbox.stub(pubSubStub, 'publish');
      osCpuStub = sandbox.stub(os, 'cpus', () => ({
        length: 8
      }));
    });

    function resetSpies() {
      agendaSpy.init.reset();
      agendaSpy.processEvery.reset();
      agendaSpy.maxConcurrency.reset();
      agendaSpy.defaultConcurrency.reset();
      agendaSpy.defaultLockLifetime.reset();
      agendaSpy.jobsAsync.reset();
      agendaSpy.start.reset();
      agendaSpy.define.reset();
      agendaSpy.create.reset();
      agendaSpy.everyAsync.reset();
      agendaSpy.cancelAsync.reset();
      agendaSpy.scheduleAsync.reset();
      agendaSpy.nowAsync.reset();
      agendaSpy.stop.reset();
      agendaSpy.on.reset();
      subscribeSpy.reset();
      publishSpy.reset();
      jobSpy.unique.reset();
      jobSpy.repeatEvery.reset();
      jobSpy.schedule.reset();
      jobSpy.computeNextRunAt.reset();
      jobSpy.runAsync.reset();
      jobSpy.saveAsync.reset();
      logSpy.reset();
      agendaEventHandlers = {};
      schedulerStartFailed = false;
    }
    afterEach(function () {
      resetSpies();
      agendaJobs.splice(0, agendaJobs.length);
    });
    after(function () {
      sandbox.restore();
    });

    describe('#InitializeScheduler', function () {
      it('should exit & must not initialize scheduler if joblist is empty', function () {
        process.env.job = {};
        schedulerConfig.job_types = '';
        const scheduler = new Scheduler();
        delete process.env.job;
        scheduler.shutDownHook();
        schedulerConfig.job_types = jobTypes;
        expect(subscribeSpy).not.to.be.called;
      });
      it('should initialize scheduler successfully for mongo & app shutdown events', function () {
        const scheduler = new Scheduler();
        scheduler.shutDownHook();
        expect(subscribeSpy).to.be.calledThrice;
        expect(subscribeSpy.firstCall.args[0]).to.eql(CONST.TOPIC.MONGO_OPERATIONAL);
        expect(subscribeSpy.firstCall.args[1]).to.be.a('function');
        expect(subscribeSpy.secondCall.args[0]).to.eql(CONST.TOPIC.MONGO_INIT_FAILED);
        expect(subscribeSpy.secondCall.args[1]).to.be.a('function');
        expect(subscribeSpy.thirdCall.args[0]).to.eql(CONST.TOPIC.APP_SHUTTING_DOWN);
        expect(subscribeSpy.thirdCall.args[1]).to.be.a('function');
      });
      it('should set agenda initialization status to 1 on recieving mongo init failure event', function () {
        //PUBSUB is exclusively used only in test cases to test for mongo event handler.
        //In all other test cases it uses the stub version of pub-sub
        const scheduler = new SchedulerPubSub();
        pubsub.publishSync(CONST.TOPIC.MONGO_INIT_FAILED, {
          mongoose: mongooseConnectionStub
        });
        expect(scheduler.initialized).to.eql(MONGO_INIT_FAILED);
        scheduler.shutDownHook();
      });
      it('should initialize agenda on recieving mongo operational event & process once every ${schedulerConfig.max_workers} minutes (#of workers)', function () {
        process.env.job = {};
        const scheduler = new SchedulerPubSub();
        pubsub.publishSync(CONST.TOPIC.MONGO_OPERATIONAL, {
          mongoose: mongooseConnectionStub
        });
        scheduler.shutDownHook();
        delete process.env.job;
        expect(agendaSpy.init).to.be.calledOnce;
        expect(agendaSpy.init.firstCall.args[0].db.collection).to.eql('agendaJobDetails');
        expect(agendaSpy.init.firstCall.args[0].name).to.eql(`${os.hostname()}-${process.pid}`);
        expect(agendaSpy.processEvery).to.be.calledOnce;
        expect(agendaSpy.processEvery.firstCall.args[0]).to.eql('4 minutes');
        expect(agendaSpy.maxConcurrency).to.be.calledOnce;
        expect(agendaSpy.maxConcurrency.firstCall.args[0]).to.eql(30);
        expect(agendaSpy.defaultConcurrency).to.be.calledOnce;
        expect(agendaSpy.defaultConcurrency.firstCall.args[0]).to.eql(20);
        expect(agendaSpy.defaultLockLifetime).to.be.calledOnce;
        expect(agendaSpy.defaultLockLifetime.firstCall.args[0]).to.eql(180000);
        expect(agendaSpy.on).to.be.calledTwice; //on 'ready' & on 'error'
        expect(agendaSpy.on.firstCall.args[0]).to.eql('ready');
      });
      it('should initialize agenda on recieving mongo operational event & process once every (#of cpus)-1 mintues', function () {
        const cpuCount = os.cpus().length;
        schedulerConfig.max_workers = 100;
        process.env.job = {};
        const scheduler = new SchedulerPubSub();
        pubsub.publishSync(CONST.TOPIC.MONGO_OPERATIONAL, {
          mongoose: mongooseConnectionStub
        });
        scheduler.shutDownHook();
        schedulerConfig.max_workers = 4;
        delete process.env.job;
        expect(agendaSpy.init).to.be.calledOnce;
        expect(agendaSpy.init.firstCall.args[0].db.collection).to.eql('agendaJobDetails');
        expect(agendaSpy.init.firstCall.args[0].name).to.eql(`${os.hostname()}-${process.pid}`);
        expect(agendaSpy.processEvery).to.be.calledOnce;
        expect(agendaSpy.processEvery.firstCall.args[0]).to.eql(`${cpuCount - 1} minutes`);
        expect(agendaSpy.maxConcurrency).to.be.calledOnce;
        expect(agendaSpy.maxConcurrency.firstCall.args[0]).to.eql(30);
        expect(agendaSpy.defaultConcurrency).to.be.calledOnce;
        expect(agendaSpy.defaultConcurrency.firstCall.args[0]).to.eql(20);
        expect(agendaSpy.defaultLockLifetime).to.be.calledOnce;
        expect(agendaSpy.defaultLockLifetime.firstCall.args[0]).to.eql(180000);
        expect(agendaSpy.on).to.be.calledTwice; //on 'ready' & on 'error'
        expect(agendaSpy.on.firstCall.args[0]).to.eql('ready');
      });
      it('should register job definitions & start agenda successfully', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_OPERATIONAL, {
          mongoose: mongooseConnectionStub
        });
        return agendaEventHandlers
          .ready()
          .then(() => {
            scheduler.shutDownHook();
            //jobsAsync is called twice - once during jobRegistration & second as part of internal mongodb schedule (post define, data retrieved from db)
            expect(agendaSpy.define).to.be.calledTwice;
            expect(agendaSpy.define.firstCall.args[0]).to.eql('ScheduledBackup');
            expect(agendaSpy.define.secondCall.args[0]).to.eql('ScheduledOobDeploymentBackup');
            expect(agendaSpy.start).to.be.calledOnce;
            expect(publishSpy).to.be.calledTwice;
            expect(publishSpy.firstCall.args[0]).to.eql(CONST.TOPIC.SCHEDULER_STARTED);
            expect(publishSpy.secondCall.args[0]).to.eql(CONST.TOPIC.SCHEDULER_READY);
            expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          });
      });
      it('should register job definitions & must log error on agenda start failures', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_OPERATIONAL, {
          mongoose: mongooseConnectionStub
        });
        schedulerStartFailed = true;
        return agendaEventHandlers
          .ready()
          .then(() => {
            scheduler.shutDownHook();
            //jobsAsync is called twice - once during jobRegistration & second as part of internal mongodb schedule (post define, data retrieved from db)
            expect(agendaSpy.define).to.be.calledTwice;
            expect(agendaSpy.define.firstCall.args[0]).to.eql('ScheduledBackup');
            expect(agendaSpy.define.secondCall.args[0]).to.eql('ScheduledOobDeploymentBackup');
            expect(agendaSpy.start).to.be.calledOnce;
            expect(publishSpy).not.to.be.called;
            expect(logSpy).to.be.calledThrice; //twice from registerJobDefinitions and once from startScheduler
            expect(scheduler.initialized).to.eql(MONGO_TO_BE_INITIALIZED);
          });
      });
      it('should register job definitions & should log error if agenda errors', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_OPERATIONAL, {
          mongoose: mongooseConnectionStub
        });
        return agendaEventHandlers
          .error()
          .then(() => {
            scheduler.shutDownHook();
            //jobsAsync is called twice - once during jobRegistration & second as part of internal mongodb schedule (post define, data retrieved from db)
            expect(agendaSpy.define).not.to.be.called;
            expect(publishSpy).not.to.be.called;
            expect(logSpy).to.be.calledOnce;
            expect(scheduler.initialized).to.eql(MONGO_TO_BE_INITIALIZED);
          });
      });
      it('should register job definitions but should not start agenda if either run_with_web flag is set to false or not running in batch mode', function () {
        schedulerConfig.run_with_web_process = false;
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_OPERATIONAL, {
          mongoose: mongooseConnectionStub
        });
        return agendaEventHandlers
          .ready()
          .then(() => {
            delete schedulerConfig.run_with_web_process;
            scheduler.shutDownHook();
            //jobsAsync is called twice - once during jobRegistration & second as part of internal mongodb schedule (post define, data retrieved from db)
            expect(agendaSpy.define).to.be.calledTwice;
            expect(agendaSpy.define.firstCall.args[0]).to.eql('ScheduledBackup');
            expect(agendaSpy.define.secondCall.args[0]).to.eql('ScheduledOobDeploymentBackup');
            expect(agendaSpy.start).not.to.be.calledOnce;
            expect(publishSpy).to.be.calledOnce;
            expect(publishSpy.firstCall.args[0]).to.eql(CONST.TOPIC.SCHEDULER_READY);
            expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          });
      });
    });

    describe('#ScheduleJobs', function () {
      it('should schedule a job successfully', function (done) {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(agendaSpy.define).to.be.calledTwice;
          //The above count is for the two job types defined in config
          expect(agendaSpy.start).to.be.calledOnce;
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          resetSpies();
          return scheduler.schedule('NONAME', CONST.JOB.SCHEDULED_BACKUP, '*/1 * * * *')
            .then(() => {
              expect(agendaSpy.create).to.be.calledOnce;
              expect(jobSpy.unique).to.be.calledOnce;
              expect(jobSpy.unique.firstCall.args[0]).to.eql({
                'data._n_a_m_e_': `NONAME_${CONST.JOB.SCHEDULED_BACKUP}`
              });
              expect(jobSpy.repeatEvery).to.be.calledOnce;
              expect(jobSpy.repeatEvery.firstCall.args[0]).to.eql('*/1 * * * *');
              expect(jobSpy.computeNextRunAt).to.be.calledOnce;
              expect(jobSpy.saveAsync).to.be.calledOnce;
              scheduler.shutDownHook();
              done();
            });
        });
      });
      it('should schedule a job successfully for a valid human-interval', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(agendaSpy.define).to.be.calledTwice;
          //The above count is for the two job types defined in config
          expect(agendaSpy.start).to.be.calledOnce;
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          resetSpies();
          return scheduler.schedule('NONAME', CONST.JOB.SCHEDULED_BACKUP, '1.5 minutes', {
            instance_id: '888888888',
            type: 'Online',
            trigger: 'User_Scheduled',
            timeZone: 'America/New_York'
          }).then(() => {
            expect(agendaSpy.create).to.be.calledOnce;
            expect(jobSpy.unique).to.be.calledOnce;
            expect(jobSpy.unique.firstCall.args[0]).to.eql({
              'data._n_a_m_e_': `NONAME_${CONST.JOB.SCHEDULED_BACKUP}`
            });
            expect(jobSpy.repeatEvery).to.be.calledOnce;
            expect(jobSpy.repeatEvery.firstCall.args[0]).to.eql('1.5 minutes');
            expect(jobSpy.repeatEvery.firstCall.args[1]).to.eql({
              timezone: 'America/New_York'
            });
            expect(jobSpy.computeNextRunAt).to.be.calledOnce;
            expect(jobSpy.saveAsync).to.be.calledOnce;
            scheduler.shutDownHook();
          });
        });
      });
      it('should schedule a job to be run once at the given time', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(agendaSpy.define).to.be.calledTwice;
          //The above count is for the two job types defined in config
          expect(agendaSpy.start).to.be.calledOnce;
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          resetSpies();
          const runAt = '10 minutes from now';
          return scheduler.runAt('NONAME', CONST.JOB.SCHEDULED_BACKUP, runAt, {
            instance_id: '888888888',
            type: 'Online',
            trigger: 'User_Scheduled'
          }).then(() => {
            expect(agendaSpy.create).to.be.calledOnce;
            expect(jobSpy.unique).to.be.calledOnce;
            expect(jobSpy.unique.firstCall.args[0]).to.eql({
              'data._n_a_m_e_': `NONAME_${CONST.JOB.SCHEDULED_BACKUP}_${runAt.replace(/\s*/g, '')}_${new Date().getTime()}`
            });
            expect(jobSpy.schedule).to.be.calledOnce;
            expect(jobSpy.schedule.firstCall.args[0]).to.eql(runAt);
            expect(jobSpy.saveAsync).to.be.calledOnce;
            scheduler.shutDownHook();
          });
        });
      });
      it('should schedule a job to be run once at the given time and must create unique job criteria based on jobdata ', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(agendaSpy.define).to.be.calledTwice;
          //The above count is for the two job types defined in config
          expect(agendaSpy.start).to.be.calledOnce;
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          resetSpies();
          const runAt = '10 minutes from now';
          return scheduler.runAt('NONAME', CONST.JOB.SCHEDULED_BACKUP, runAt, {
            instance_id: '888888888',
            type: 'Online',
            trigger: 'User_Scheduled',
            _n_a_m_e_: `NONAME_${CONST.JOB.SCHEDULED_BACKUP}_${runAt.replace(/\s*/g, '')}_${new Date().getTime()}`
          }, CONST.SYSTEM_USER, true).then(() => {
            expect(agendaSpy.create).to.be.calledOnce;
            expect(jobSpy.unique).to.be.calledOnce;
            expect(jobSpy.unique.firstCall.args[0]).to.eql({
              'data.instance_id': '888888888',
              'data.type': 'Online',
              'data.trigger': 'User_Scheduled'
            });
            expect(jobSpy.schedule).to.be.calledOnce;
            expect(jobSpy.schedule.firstCall.args[0]).to.eql(runAt);
            expect(jobSpy.saveAsync).to.be.calledOnce;
            scheduler.shutDownHook();
          });
        });
      });
      it('should schedule a job to be run once at the given time with undefined job data', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(agendaSpy.define).to.be.calledTwice;
          //The above count is for the two job types defined in config
          expect(agendaSpy.start).to.be.calledOnce;
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          resetSpies();
          const runAt = '10 minutes from now';
          return scheduler.runAt('NONAME', CONST.JOB.SCHEDULED_BACKUP, runAt)
            .then(() => {
              expect(agendaSpy.create).to.be.calledOnce;
              expect(jobSpy.unique).to.be.calledOnce;
              expect(jobSpy.unique.firstCall.args[0]).to.eql({
                'data._n_a_m_e_': `NONAME_${CONST.JOB.SCHEDULED_BACKUP}_${runAt.replace(/\s*/g, '')}_${new Date().getTime()}`
              });
              expect(jobSpy.schedule).to.be.calledOnce;
              expect(jobSpy.schedule.firstCall.args[0]).to.eql(runAt);
              expect(jobSpy.saveAsync).to.be.calledOnce;
              scheduler.shutDownHook();
            });
        });
      });
      it('should run the specified job immediately', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(agendaSpy.define).to.be.calledTwice;
          //The above count is for the two job types defined in config
          expect(agendaSpy.start).to.be.calledOnce;
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          resetSpies();
          return scheduler.runNow('NONAME', CONST.JOB.SCHEDULED_BACKUP, {
            instance_id: '888888888',
            type: 'Online',
            trigger: 'User_Scheduled'
          }).then(() => {
            expect(agendaSpy.create).to.be.calledOnce;
            expect(jobSpy.unique).to.be.calledOnce;
            expect(jobSpy.unique.firstCall.args[0]['data._n_a_m_e_']).to.have.string(`NONAME_${CONST.JOB.SCHEDULED_BACKUP}`);
            expect(jobSpy.saveAsync).to.be.calledOnce;
            expect(jobSpy.runAsync).to.be.calledOnce;
            scheduler.shutDownHook();
          });
        });
      });
      it('should run the specified job immediately with undefined jobdata', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(agendaSpy.define).to.be.calledTwice;
          //The above count is for the two job types defined in config
          expect(agendaSpy.start).to.be.calledOnce;
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          resetSpies();
          return scheduler.runNow('NONAME', CONST.JOB.SCHEDULED_BACKUP)
            .then(() => {
              expect(agendaSpy.create).to.be.calledOnce;
              expect(jobSpy.unique).to.be.calledOnce;
              expect(jobSpy.unique.firstCall.args[0]['data._n_a_m_e_']).to.have.string(`NONAME_${CONST.JOB.SCHEDULED_BACKUP}`);
              expect(jobSpy.saveAsync).to.be.calledOnce;
              expect(jobSpy.runAsync).to.be.calledOnce;
              scheduler.shutDownHook();
            });
        });
      });
      it('should throw error when trying to schedule a job that is not enabled in system', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(agendaSpy.define).to.be.calledTwice;
          //The above count is for the two job types defined in config
          expect(agendaSpy.start).to.be.calledOnce;
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          resetSpies();
          const unConfiguredJobType = 'SystemUpdate';
          scheduler.jobTypeList = [];
          //Just clearing the job list. Ideally scheduler.job_types list in config has to be updated to enable/disable
          return scheduler.schedule('NONAME', CONST.JOB.SCHEDULED_BACKUP, '*/1 * * * * ', {
            instance_id: '888888888',
            type: 'Online',
            trigger: 'User_Scheduled'
          }).catch(error => {
            expect(error.name).to.eql((new errors.ServiceUnavailable()).name);
            expect(error.message).to.eql(`${CONST.JOB.SCHEDULED_BACKUP} is not enabled in the system. Cannot be scheduled`);
            scheduler.shutDownHook();
          });
        });
      });
      it('should throw exception for invalid cron interval', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          let invalidInterval = 'INVALID';
          return scheduler
            .schedule('NONAME', CONST.JOB.SCHEDULED_BACKUP, invalidInterval, {})
            .then(() => {
              throw new Error('Test Failed. Shouldve thrown exception');
            })
            .catch(error => {
              if (!(error instanceof errors.BadRequest)) {
                throw error;
              }
              scheduler.shutDownHook();
              expect(error.name).to.eql((new errors.BadRequest()).name);
              expect(error.message).to.eql(`Invalid interval - ${invalidInterval}. Must be a valid cron expression or a valid human readable duration`);
            });
        });
      });
      it('should throw exception for invalid timezone', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          return scheduler.schedule('NONAME', CONST.JOB.SCHEDULED_BACKUP, '*/1 * * * *', {
            timeZone: 'INVALID_TIME_ZONE'
          }).catch(error => {
            scheduler.shutDownHook();
            expect(error.name).to.eql((new errors.BadRequest()).name);
            expect(error.message).to.contain('Invalid timezone. Valid zones:');
          });
        });
      });

      it('should reject schedule request when MongoDB init failed', function () {
        const scheduler = new SchedulerPubSub();
        pubsub.publishSync(CONST.TOPIC.MONGO_INIT_FAILED, {
          mongoose: mongooseConnectionStub
        });
        expect(scheduler.initialized).to.eql(MONGO_INIT_FAILED);
        return scheduler
          .schedule('NONAME', CONST.JOB.SCHEDULED_BACKUP, '*/1 * * * * ', {
            instance_id: '888888888',
            type: 'Online',
            trigger: 'User_Scheduled'
          })
          .catch(error => {
            expect(error.name).to.eql((new errors.ServiceUnavailable().name));
            scheduler.shutDownHook();
          });
      });
      it('should reject runAt request when MongoDB init failed', function () {
        const scheduler = new SchedulerPubSub();
        pubsub.publishSync(CONST.TOPIC.MONGO_INIT_FAILED, {
          mongoose: mongooseConnectionStub
        });
        expect(scheduler.initialized).to.eql(MONGO_INIT_FAILED);
        const runAt = '10 minutes from now';
        return scheduler.runAt('NONAME', CONST.JOB.SCHEDULED_BACKUP, runAt, {
            instance_id: '888888888',
            type: 'Online',
            trigger: 'User_Scheduled'
          })
          .catch(error => {
            expect(error.name).to.eql((new errors.ServiceUnavailable().name));
            scheduler.shutDownHook();
          });
      });
      it('should reject runImmediately request when MongoDB init failed', function () {
        const scheduler = new SchedulerPubSub();
        pubsub.publishSync(CONST.TOPIC.MONGO_INIT_FAILED, {
          mongoose: mongooseConnectionStub
        });
        expect(scheduler.initialized).to.eql(MONGO_INIT_FAILED);
        return scheduler.runNow('NONAME', CONST.JOB.SCHEDULED_BACKUP, {
            instance_id: '888888888',
            type: 'Online',
            trigger: 'User_Scheduled'
          })
          .catch(error => {
            expect(error.name).to.eql((new errors.ServiceUnavailable().name));
            scheduler.shutDownHook();
          });
      });
    });

    describe('#getJobSchedule', function () {
      it('should return the job schedule for scheduled job successfully', function () {
        const scheduler = new Scheduler();
        expect(scheduler.initialized).to.eql(MONGO_TO_BE_INITIALIZED);
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          return scheduler
            .getJob('9999-8888-7777-6666', CONST.JOB.SCHEDULED_BACKUP)
            .then(job => {
              expect(job.name).to.eql(CONST.JOB.SCHEDULED_BACKUP);
              expect(job.repeatInterval).to.eql('*/1 * * * *');
              expect(job.repeatTimezone).to.eql('America/New_York');
              expect(job.data).to.eql({
                instance_id: '9999-8888-7777-6666'
              });
              expect(job.lastRunAt).to.be.instanceof(Date);
              expect(job.nextRunAt).to.be.instanceof(Date);
              expect(job.lockedAt).to.eql(null);
              scheduler.shutDownHook();
            });
        });
      });
      it('should return the job schedule for scheduled job successfully & overridden lastRunAt timestamp', function () {
        const scheduler = new Scheduler();
        expect(scheduler.initialized).to.eql(MONGO_TO_BE_INITIALIZED);
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          return scheduler
            .getJob('9999-8888-7777-7777', CONST.JOB.SCHEDULED_BACKUP)
            .then(job => {
              expect(job.name).to.eql(CONST.JOB.SCHEDULED_BACKUP);
              expect(job.repeatInterval).to.eql('*/1 * * * *');
              expect(job.repeatTimezone).to.eql('America/New_York');
              expect(job.data).to.eql({
                instance_id: '9999-8888-7777-7777'
              });
              expect(job.lastRunAt).to.be.instanceof(Date);
              expect(job.nextRunAt).to.be.instanceof(Date);
              expect(job.nextRunAt).to.eql(new Date(0));
              expect(job.lockedAt).to.eql(null);
              scheduler.shutDownHook();
            });
        });
      });
      it('should not error when queried for schedule of a job which is not yet scheduled', function () {
        const scheduler = new Scheduler();
        expect(scheduler.initialized).to.eql(MONGO_TO_BE_INITIALIZED);
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        const runAt = '10 minutes from now';
        return scheduler.startScheduler().then(() => {
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          return scheduler
            .getJob('1234-5678-8888-3333', CONST.JOB.SCHEDULED_BACKUP)
            .then(job => {
              expect(agendaSpy.jobsAsync).to.be.calledOnce;
              const criteria = {
                name: CONST.JOB.SCHEDULED_BACKUP,
                nextRunAt: {
                  $ne: null
                }
              };
              criteria[`data.${CONST.JOB_NAME_ATTRIB}`] = {
                $regex: `^1234-5678-8888-3333_${CONST.JOB.SCHEDULED_BACKUP}.*`
              };
              expect(agendaSpy.jobsAsync.firstCall.args[0]).to.be.eql(criteria);
              expect(job).to.eql(null);
            });
        });
      });
      it('should reject get Job request when MongoDB init failed', function () {
        const scheduler = new SchedulerPubSub();
        pubsub.publishSync(CONST.TOPIC.MONGO_INIT_FAILED, {
          mongoose: mongooseConnectionStub
        });
        expect(scheduler.initialized).to.eql(MONGO_INIT_FAILED);
        return scheduler
          .getJob('1234-5678-8888-3333', CONST.JOB.SCHEDULED_BACKUP)
          .catch(error => {
            expect(error.name).to.eql((new errors.ServiceUnavailable().name));
            scheduler.shutDownHook();
          });
      });
    });

    describe('#cancelJobSchedule', function () {
      it('should cancel the schedule for input job successfully', function () {
        const scheduler = new Scheduler();
        expect(scheduler.initialized).to.eql(MONGO_TO_BE_INITIALIZED);
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          return scheduler
            .cancelJob('9999-8888-7777-6666', CONST.JOB.SCHEDULED_BACKUP)
            .then(job => {
              expect(job).to.eql({});
              expect(agendaSpy.cancelAsync).to.be.calledOnce;
              const retentionDate = new Date(moment().subtract(schedulerConfig.job_history_retention_in_days, 'days').toISOString());
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
              expect(agendaSpy.cancelAsync.firstCall.args[0]).to.be.eql({
                name: 'ScheduledBackup',
                'data._n_a_m_e_': `9999-8888-7777-6666_${CONST.JOB.SCHEDULED_BACKUP}`
              });
            });
        });
      });

      it('should not error if cancel job is requested for an non-existent job', function () {
        const scheduler = new Scheduler();
        expect(scheduler.initialized).to.eql(MONGO_TO_BE_INITIALIZED);
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          return scheduler
            .cancelJob('1212-8888-9999-6666', CONST.JOB.SCHEDULED_BACKUP)
            .then(job => {
              expect(job).to.eql({});
              expect(agendaSpy.cancelAsync).to.be.calledOnce;
              const retentionDate = new Date(moment().subtract(schedulerConfig.job_history_retention_in_days, 'days').toISOString());
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
              expect(agendaSpy.cancelAsync.firstCall.args[0]).to.be.eql({
                name: 'ScheduledBackup',
                'data._n_a_m_e_': '1212-8888-9999-6666_ScheduledBackup'
              });
            });
        });
      });
    });

    describe('#RunJobs', function () {
      const job = {
        attrs: {
          name: `${CONST.JOB.BLUEPRINT_JOB}`,
          data: {
            type: 'online',
            trigger: CONST.BACKUP.TRIGGER.SCHEDULED
          },
          lastRunAt: new Date(),
          nextRunAt: new Date(),
          repeatInterval: '*/1 * * * *',
          lockedAt: null,
          repeatTimezone: 'America/New_York'
        },
        fail: () => undefined,
        save: () => undefined
      };
      job.attrs.data[CONST.JOB_NAME_ATTRIB] = `NONAME_${CONST.JOB.BLUEPRINT_JOB}`;
      let baseJobLogRunHistoryStub, jobDoneSpy, maintenaceManagerStub, runSandBox, processExitStub;
      let maintenanceStatus = 0;
      let jobTypesOld;

      before(function () {
        runSandBox = sinon.sandbox.create();
        baseJobLogRunHistoryStub = runSandBox.stub(BaseJob, 'logRunHistory', () => Promise.resolve({}));
        maintenaceManagerStub = runSandBox.stub(maintenanceManager, 'getMaintenaceInfo',
          () => maintenanceStatus === 0 ? Promise.resolve(null) :
          (maintenanceStatus === 1 ? Promise.resolve(null) : Promise.resolve({
            maintenance: true,
            progress: [`${schedulerConfig.downtime_maintenance_phases[0]} at ${new Date()}`],
          })));
        jobDoneSpy = sinon.spy();
        processExitStub = runSandBox.stub(process, 'exit');
        jobTypesOld = schedulerConfig.job_types;
        schedulerConfig.job_types = CONST.JOB.BLUEPRINT_JOB;
      });
      afterEach(function () {
        maintenanceStatus = 0;
        baseJobLogRunHistoryStub.reset();
        processExitStub.reset();
        jobDoneSpy.reset();
      });
      after(function () {
        runSandBox.restore();
        schedulerConfig.job_types = jobTypesOld;
      });

      it('should run the scheduled job successfully when system is not in maintenance', function () {
        const scheduler = new Scheduler();
        const veryOldDate = new Date('1 Jan 1970');
        const jb = _.cloneDeep(job);
        jb.attrs.data.attempt = 2;
        jb.attrs.data.firstAttemptAt = veryOldDate;
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
            expect(agendaSpy.define).to.be.calledOnce;
            //The above count is for the two job types defined in config
            expect(agendaSpy.start).to.be.calledOnce;
            expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
            resetSpies();
          })
          .then(() => {
            return scheduler.schedule('NONAME', CONST.JOB.BLUEPRINT_JOB, '*/1 * * * *', {
              instance_id: '888888888',
              type: 'Online',
              trigger: 'scheduled'
            });
          })
          .then(() => {
            expect(agendaSpy.create).to.be.calledOnce;
            expect(jobSpy.unique).to.be.calledOnce;
            expect(jobSpy.unique.firstCall.args[0]).to.eql({
              'data._n_a_m_e_': `NONAME_${CONST.JOB.BLUEPRINT_JOB}`
            });
            expect(jobSpy.repeatEvery).to.be.calledOnce;
            expect(jobSpy.repeatEvery.firstCall.args[0]).to.eql('*/1 * * * *');
            expect(jobSpy.computeNextRunAt).to.be.calledOnce;
            expect(jobSpy.saveAsync).to.be.calledOnce;
            return agendaJobs[0](jb, jobDoneSpy);
          })
          .then(() => {
            expect(baseJobLogRunHistoryStub).to.be.calledOnce;
            expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.eql(undefined);
            expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql({
              status: 'success'
            });
            expect(baseJobLogRunHistoryStub.firstCall.args[2]).to.equal(jb);
            expect(jobDoneSpy).to.be.calledOnce;
            return scheduler.shutDownHook();
          });
      });
      it('should reschedule the scheduled job when system is in maintenance', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        maintenanceStatus = 2;
        return scheduler.startScheduler().then(() => {
            expect(agendaSpy.define).to.be.calledOnce;
            //The above count is for the two job types defined in config
            expect(agendaSpy.start).to.be.calledOnce;
            expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
            resetSpies();
          })
          .then(() => {
            return scheduler.schedule('NONAME', CONST.JOB.BLUEPRINT_JOB, '*/1 * * * *', {
              instance_id: '888888888',
              type: 'Online',
              trigger: 'scheduled'
            });
          })
          .then(() => {
            expect(agendaSpy.create).to.be.calledOnce;
            expect(jobSpy.unique).to.be.calledOnce;
            expect(jobSpy.unique.firstCall.args[0]).to.eql({
              'data._n_a_m_e_': `NONAME_${CONST.JOB.BLUEPRINT_JOB}`
            });
            expect(jobSpy.repeatEvery).to.be.calledOnce;
            expect(jobSpy.repeatEvery.firstCall.args[0]).to.eql('*/1 * * * *');
            expect(jobSpy.saveAsync).to.be.calledOnce;
            resetSpies();
            return agendaJobs[0](job, jobDoneSpy);
          })
          .then(() => {
            expect(baseJobLogRunHistoryStub).to.be.calledOnce;
            expect(baseJobLogRunHistoryStub.firstCall.args[0] instanceof errors.ServiceInMaintenance).to.eql(true);
            expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql('System in maintenance');
            expect(baseJobLogRunHistoryStub.firstCall.args[2]).to.equal(job);
            expect(jobDoneSpy).to.be.calledOnce;
            expect(agendaSpy.create).to.be.calledOnce;
            expect(jobSpy.unique).to.be.calledOnce;
            const jobName = `NONAME_${CONST.JOB.BLUEPRINT_JOB}_${schedulerConfig.jobs.reschedule_delay.replace(/\s*/g, '')}_${new Date().getTime()}`;
            expect(jobSpy.unique.firstCall.args[0]).to.eql({
              'data._n_a_m_e_': jobName
            });
            expect(jobSpy.schedule).to.be.calledOnce;
            expect(jobSpy.schedule.firstCall.args[0]).to.eql(schedulerConfig.jobs.reschedule_delay);
            expect(jobSpy.saveAsync).to.be.calledOnce;
            expect(processExitStub).to.be.calledOnce;
            expect(processExitStub.firstCall.args[0]).to.eql(CONST.ERR_CODES.SF_IN_MAINTENANCE);
            return scheduler.shutDownHook();
          });
      });
    });
    describe('#PurgeOldJobs', function () {
      it('should stop agenda on recieving app shutdown event -', function () {
        const scheduler = new Scheduler();
        expect(scheduler.initialized).to.eql(MONGO_TO_BE_INITIALIZED);
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });

        return scheduler.startScheduler().then(() => {
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          return scheduler
            .purgeOldFinishedJobs()
            .then(resp => {
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
              expect(agendaSpy.cancelAsync).to.be.calledOnce;
              expect(agendaSpy.cancelAsync.firstCall.args[0]).to.eql({
                $and: criteria
              });

            });
        });
      });
    });
    describe('#Shutdown', function () {
      it('should stop agenda on recieving app shutdown event -', function () {
        const scheduler = new SchedulerPubSub();
        pubsub.publishSync(CONST.TOPIC.MONGO_OPERATIONAL, {
          mongoose: mongooseConnectionStub
        });
        return scheduler
          .startScheduler()
          .then(() => {
            expect(agendaSpy.start).to.be.calledOnce;
            expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
            pubsub.publishSync(CONST.TOPIC.APP_SHUTTING_DOWN, {});
            expect(agendaSpy.stop).to.be.calledOnce;
          });
      });
    });
  });
});