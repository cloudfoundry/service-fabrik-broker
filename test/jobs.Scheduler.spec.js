'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const proxyquire = require('proxyquire');
const mongoose = require('mongoose');
const pubsub = require('pubsub-js');
const os = require('os');
var EventEmitter = require('events').EventEmitter;
const CONST = require('../lib/constants');
const errors = require('../lib/errors');

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

class Agenda extends EventEmitter {
  constructor(options) {
    super();
    agendaStub.init(options);
    return this;
  }
  on(event, cb) {
    super.on(event, cb);
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
    agendaStub.jobsAsync();
    if (_.keys(options).length === 0) {
      return Promise.resolve(jobs);
    } else {
      if (options['data._n_a_m_e_'] === '9999-8888-7777-6666_ScheduledBackup') {
        return Promise.resolve([{
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
        }]);
      } else {
        return Promise.resolve({});
      }
    }
  }
  start() {
    agendaStub.start();
  }
  define(name, cb) {
    agendaStub.define(name, cb);
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
const proxyLibs = {
  'bluebird': {
    promisifyAll: function (list) {
      return;
    }
  },
  'agenda': Agenda,
  '../config': {
    scheduler: {
      job_types: 'ScheduledBackup',
      process_every: '1 minute',
      max_concurrency: 30,
      default_concurrency: 20,
      default_lock_lifetime: 180000,
      agenda_collection: 'agendaJobDetails'
    },
    mongodb: {
      backup: {
        schedule_interval: '0 12 * * *'
      }
    }
  }
};

const SchedulerPubSub = proxyquire('../lib/jobs/Scheduler', _.cloneDeep(proxyLibs));
const Scheduler = proxyquire('../lib/jobs/Scheduler', _.set(proxyLibs, 'pubsub-js', proxyPubSub));

describe('Jobs', function () {
  /* jshint expr:true */
  describe('Scheduler', function () {
    let agendaSpy, subscribeSpy, publishSpy, agendaSpyInit, mongooseConnectionStub, sandbox, jobSpy;
    before(function () {
      sandbox = sinon.sandbox.create();
      mongooseConnectionStub = sandbox.stub(mongoose);
      agendaSpy = sandbox.stub(agendaStub);
      jobSpy = sandbox.stub(jobStub);
      jobSpy.saveAsync.withArgs().returns(Promise.resolve({
        'a': '1'
      }));
      subscribeSpy = sandbox.stub(pubSubStub, 'subscribe');
      publishSpy = sandbox.stub(pubSubStub, 'publish');
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
      subscribeSpy.reset();
      publishSpy.reset();
      jobSpy.unique.reset();
      jobSpy.repeatEvery.reset();
      jobSpy.schedule.reset();
      jobSpy.computeNextRunAt.reset();
      jobSpy.runAsync.reset();
      jobSpy.saveAsync.reset();
    }

    afterEach(resetSpies);

    after(function () {
      sandbox.restore();
    });

    describe('#InitializeScheduler', function () {
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

      it('should initialize agenda on recieving mongo operational event', function () {
        const scheduler = new SchedulerPubSub();
        pubsub.publishSync(CONST.TOPIC.MONGO_OPERATIONAL, {
          mongoose: mongooseConnectionStub
        });
        scheduler.shutDownHook();
        expect(agendaSpy.init).to.be.calledOnce;
        expect(agendaSpy.init.firstCall.args[0].db.collection).to.eql('agendaJobDetails');
        expect(agendaSpy.init.firstCall.args[0].name).to.eql(`${os.hostname()}-${process.pid}`);
        expect(agendaSpy.processEvery).to.be.calledOnce;
        expect(agendaSpy.processEvery.firstCall.args[0]).to.eql('1 minute');
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
        return scheduler
          .startScheduler()
          .then(() => {
            scheduler.shutDownHook();
            //jobsAsync is called twice - once during jobRegistration & second as part of internal mongodb schedule (post define, data retrieved from db)
            expect(agendaSpy.define).to.be.calledOnce;
            expect(agendaSpy.define.firstCall.args[0]).to.eql('ScheduledBackup');
            expect(agendaSpy.start).to.be.calledOnce;
            expect(publishSpy).to.be.calledTwice;
            expect(publishSpy.firstCall.args[0]).to.eql(CONST.TOPIC.SCHEDULER_STARTED);
            expect(publishSpy.secondCall.args[0]).to.eql(CONST.TOPIC.SCHEDULER_READY);
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
          expect(agendaSpy.define).to.be.calledOnce;
          //The above count is for the two job types defined in config
          expect(agendaSpy.start).to.be.calledOnce;
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          resetSpies();
          return scheduler.schedule('NONAME', CONST.JOB.SCHEDULED_BACKUP, '*/1 * * * *', {
            instance_id: '888888888',
            type: 'Online',
            trigger: 'User_Scheduled'
          }).then(() => {
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
          expect(agendaSpy.define).to.be.calledOnce;
          //The above count is for the two job types defined in config
          expect(agendaSpy.start).to.be.calledOnce;
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          resetSpies();
          return scheduler.schedule('NONAME', CONST.JOB.SCHEDULED_BACKUP, '1.5 minutes', {
            instance_id: '888888888',
            type: 'Online',
            trigger: 'User_Scheduled'
          }).then(() => {
            expect(agendaSpy.create).to.be.calledOnce;
            expect(jobSpy.unique).to.be.calledOnce;
            expect(jobSpy.unique.firstCall.args[0]).to.eql({
              'data._n_a_m_e_': `NONAME_${CONST.JOB.SCHEDULED_BACKUP}`
            });
            expect(jobSpy.repeatEvery).to.be.calledOnce;
            expect(jobSpy.repeatEvery.firstCall.args[0]).to.eql('1.5 minutes');
            expect(jobSpy.computeNextRunAt).to.be.calledOnce;
            expect(jobSpy.saveAsync).to.be.calledOnce;
            scheduler.shutDownHook();
          });
        });
      });

      it('should schedule a job to be run once at the give time format', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(agendaSpy.define).to.be.calledOnce;
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
              'data._n_a_m_e_': `NONAME_${CONST.JOB.SCHEDULED_BACKUP}_${runAt.replace(/\s*/g, '')}`
            });
            expect(jobSpy.schedule).to.be.calledOnce;
            expect(jobSpy.schedule.firstCall.args[0]).to.eql(runAt);
            expect(jobSpy.computeNextRunAt).to.be.calledOnce;
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
          expect(agendaSpy.define).to.be.calledOnce;
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

      it('should throw error when trying to schedule a job that is not enabled in system', function () {
        const scheduler = new Scheduler();
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(agendaSpy.define).to.be.calledOnce;
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
          const invalidInterval = 'DOESNOTMATTER';
          return scheduler
            .schedule('NONAME', 'DOESNOTMATTER', invalidInterval, {})
            .catch(error => {
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

      it('should not error when queried for schedule of a job which is not yet scheduled', function () {
        const scheduler = new Scheduler();
        expect(scheduler.initialized).to.eql(MONGO_TO_BE_INITIALIZED);
        scheduler.initialize(CONST.TOPIC.MONGO_INIT_SUCCEEDED, {
          mongoose: mongooseConnectionStub
        });
        return scheduler.startScheduler().then(() => {
          expect(scheduler.initialized).to.eql(MONGO_INIT_SUCCEEDED);
          return scheduler
            .getJob('1234-5678-8888-3333', CONST.JOB.SCHEDULED_BACKUP)
            .then(job => {
              expect(job).to.eql({});
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
              expect(agendaSpy.cancelAsync.firstCall.args[0]).to.be.eql({
                name: 'ScheduledBackup',
                'data._n_a_m_e_': '1212-8888-9999-6666_ScheduledBackup'
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