'use strict';

const _ = require('lodash');
const proxyquire = require('proxyquire');
const CONST = require('../lib/constants');
const errors = require('../lib/errors');
const utils = require('../lib/utils');
const instance_id = '9999-8888-7777-6666';
const jobType = CONST.JOB.SCHEDULED_BACKUP;
const interval = '*/1 * * * *';
const createdAt = new Date();
const updatedAt = new Date();
const lastRunAt = new Date();
const nextRunAt = new Date();
const lockedAt = null;
const jobData = {
  instance_id: instance_id,
  type: 'online',
  timeZone: 'America/New_York'
};
const user = {
  id: '0987654321',
  name: 'kbj',
  email: 'kbj'
};
const criteria = {
  name: instance_id,
  type: jobType
};
const mergedJob = {
  name: `${instance_id}_${jobType}`,
  data: _.omit(jobData, 'timeZone'),
  lastRunAt: lastRunAt,
  nextRunAt: nextRunAt,
  lockedAt: lockedAt,
  repeatInterval: interval,
  repeatTimezone: jobData.timeZone,
  createdBy: user.email,
  updatedBy: user.email,
  createdAt: createdAt,
  updatedAt: updatedAt
};
const schedulerStub = {
  schedule: () => undefined,
  getJob: () => undefined,
  runAt: () => undefined,
  cancelJob: () => undefined
};
const repositoryStub = {
  saveOrUpdate: () => undefined,
  findOne: () => undefined,
  delete: () => undefined
};

class Scheduler {
  schedule(name, type, interval, data) {
    schedulerStub.schedule.call(schedulerStub, arguments);
    return Promise.resolve({
      name: type,
      data: _.omit(data, 'timeZone'),
      lastRunAt: lastRunAt,
      nextRunAt: nextRunAt,
      lockedAt: null,
      repeatInterval: interval,
      repeatTimezone: data.timeZone
    });
  }

  runAt(name, type, runAt, data) {
    schedulerStub.runAt.call(schedulerStub, arguments);
    return Promise.resolve({
      name: type,
      data: _.omit(data, 'timeZone'),
      lastRunAt: lastRunAt,
      nextRunAt: nextRunAt,
      lockedAt: null,
      repeatInterval: runAt,
      repeatTimezone: data.timeZone
    });
  }

  getJob(name, type) {
    schedulerStub.getJob(arguments);
    if (name !== instance_id) {
      return Promise.resolve({});
    }
    return Promise.resolve({
      name: type,
      data: _.omit(jobData, 'timeZone'),
      lastRunAt: lastRunAt,
      nextRunAt: nextRunAt,
      repeatInterval: interval,
      lockedAt: lockedAt,
      repeatTimezone: jobData.timeZone
    });
  }

  cancelJob() {
    schedulerStub.cancelJob.call(schedulerStub, arguments);
    return Promise.resolve({});
  }
}

class Repository {
  static saveOrUpdate(model, jobDetail, criteria, user) {
    repositoryStub.saveOrUpdate(arguments);
    return Promise.resolve({
      name: jobDetail.name,
      type: jobDetail.type,
      repeatInterval: jobDetail.interval,
      data: jobDetail.data,
      createdAt: createdAt,
      updatedAt: updatedAt,
      createdBy: user.email,
      updatedBy: user.email
    });
  }

  static delete() {
    repositoryStub.delete.call(repositoryStub, arguments);
    return Promise.resolve({});
  }

  static findOne(model, criteria) {
    repositoryStub.findOne.call(repositoryStub, arguments);
    if (criteria.name !== instance_id) {
      return Promise.resolve({});
    }
    return Promise.resolve({
      name: instance_id,
      type: criteria.type,
      repeatInterval: interval,
      data: {
        instance_id: criteria.name,
        type: 'online'
      },
      createdAt: createdAt,
      updatedAt: updatedAt,
      createdBy: user.email,
      updatedBy: user.email
    });
  }
}

describe('Jobs', function () {
  const ScheduleManager = proxyquire('../lib/jobs/ScheduleManager', {
    './Scheduler': Scheduler,
    '../db': {
      Repository: Repository
    }
  });
  /* jshint expr:true */
  describe('ScheduleManager', function () {
    let schedulerSpy = sinon.stub(schedulerStub);
    let repoSpy = sinon.stub(repositoryStub);

    let clock, randomIntStub;
    before(function () {
      clock = sinon.useFakeTimers();
      randomIntStub = sinon.stub(utils, 'getRandomInt', () => 0);
    });

    afterEach(function () {
      schedulerSpy.schedule.reset();
      schedulerSpy.runAt.reset();
      schedulerSpy.getJob.reset();
      schedulerSpy.cancelJob.reset();
      repoSpy.saveOrUpdate.reset();
      repoSpy.findOne.reset();
      repoSpy.delete.reset();
      clock.reset();
    });

    after(function () {
      clock.restore();
      randomIntStub.restore();
    });

    describe('#ScheduleJobs', function () {
      it('should schedule a job in agenda and save it in mongodb successfully', function (done) {
        ScheduleManager
          .schedule(instance_id, CONST.JOB.SCHEDULED_BACKUP, interval, jobData, user)
          .done((jobResponse) => {
            expect(jobResponse).to.eql(mergedJob);
            expect(schedulerSpy.schedule).to.be.calledOnce;
            expect(schedulerSpy.schedule.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.schedule.firstCall.args[0][1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
            expect(schedulerSpy.schedule.firstCall.args[0][2]).to.eql(interval);
            expect(schedulerSpy.schedule.firstCall.args[0][3]).to.eql(jobData);
            const jobToBeSavedInDB = {
              name: instance_id,
              type: jobType,
              interval: interval,
              data: jobData
            };
            expect(repoSpy.saveOrUpdate).to.be.calledOnce;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][1]).to.eql(jobToBeSavedInDB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][2]).to.eql(criteria);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][3]).to.eql(user);
            done();
          });
      });
      it('should schedule a job in agenda with daily random schedule and save it in mongodb successfully', function (done) {
        ScheduleManager
          .scheduleDaily(instance_id, CONST.JOB.SCHEDULED_BACKUP, jobData, user)
          .done((jobResponse) => {
            const expectedResponse = _.cloneDeep(mergedJob);
            const randomInterval = '0 0 * * *';
            expectedResponse.repeatInterval = randomInterval;
            expect(jobResponse).to.eql(expectedResponse);
            expect(schedulerSpy.schedule).to.be.calledOnce;
            expect(schedulerSpy.schedule.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.schedule.firstCall.args[0][1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
            expect(schedulerSpy.schedule.firstCall.args[0][2]).to.eql(randomInterval);
            expect(schedulerSpy.schedule.firstCall.args[0][3]).to.eql(jobData);
            const jobToBeSavedInDB = {
              name: instance_id,
              type: jobType,
              interval: randomInterval,
              data: jobData
            };
            expect(repoSpy.saveOrUpdate).to.be.calledOnce;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][1]).to.eql(jobToBeSavedInDB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][2]).to.eql(criteria);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][3]).to.eql(user);
            done();
          });
      });
      it('should schedule a job in agenda and save it in mongodb successfully at specified time', function (done) {
        const scheduleAt = '10 mins from now';
        ScheduleManager
          .runAt(instance_id, CONST.JOB.SCHEDULED_BACKUP, scheduleAt, jobData, user)
          .done((jobResponse) => {
            const expectedResponse = _.cloneDeep(mergedJob);
            expectedResponse.repeatInterval = scheduleAt;
            expect(jobResponse).to.eql(expectedResponse);
            expect(schedulerSpy.runAt).to.be.calledOnce;
            expect(schedulerSpy.runAt.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.runAt.firstCall.args[0][1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
            expect(schedulerSpy.runAt.firstCall.args[0][2]).to.eql(scheduleAt);
            expect(schedulerSpy.runAt.firstCall.args[0][3]).to.eql(jobData);
            const jobToBeSavedInDB = {
              name: instance_id,
              type: jobType,
              interval: scheduleAt,
              data: jobData
            };
            expect(repoSpy.saveOrUpdate).to.be.calledOnce;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][1]).to.eql(jobToBeSavedInDB);
            const expectedCriteria = _.clone(criteria);
            expectedCriteria.type = `${CONST.JOB.SCHEDULED_BACKUP}_0`;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][2]).to.eql(expectedCriteria);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][3]).to.eql(user);
            done();
          });
      });
    });

    describe('#getJobSchedule', function () {
      it('should return the job schedule for scheduled job by merging job details from agenda & mongodb successfully', function (done) {
        ScheduleManager
          .getSchedule(instance_id, CONST.JOB.SCHEDULED_BACKUP)
          .done((jobResponse) => {
            expect(jobResponse).to.eql(mergedJob);
            expect(schedulerSpy.getJob).to.be.calledOnce;
            expect(schedulerSpy.getJob.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.getJob.firstCall.args[0][1]).to.eql(jobType);
            expect(repoSpy.findOne).to.be.calledOnce;
            expect(repoSpy.findOne.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.findOne.firstCall.args[0][1]).to.eql(criteria);
            done();
          });
      });

      it('should error when queried for schedule for a job which is not yet scheduled', function (done) {
        return ScheduleManager
          .getSchedule('0625-6252-7654-9999', CONST.JOB.SCHEDULED_BACKUP)
          .catch(errors.NotFound, () => {
            expect(schedulerSpy.getJob).to.be.calledOnce;
            expect(schedulerSpy.getJob.firstCall.args[0][0]).to.eql('0625-6252-7654-9999');
            expect(schedulerSpy.getJob.firstCall.args[0][1]).to.eql(jobType);
            expect(repoSpy.findOne).not.to.be.called;
            done();
          });
      });
    });

    describe('#cancelJobSchedule', function () {
      it('should cancel the schedule for input job in agenda and delete the job from mongodb successfully', function (done) {
        ScheduleManager
          .cancelSchedule(instance_id, CONST.JOB.SCHEDULED_BACKUP)
          .done((jobResponse) => {
            expect(jobResponse).to.eql({});
            expect(schedulerSpy.cancelJob).to.be.calledOnce;
            expect(schedulerSpy.cancelJob.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.cancelJob.firstCall.args[0][1]).to.eql(jobType);
            expect(repoSpy.delete).to.be.calledOnce;
            expect(repoSpy.delete.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.delete.firstCall.args[0][1]).to.eql(criteria);
            done();
          });
      });

      it('should not error if cancel job is requested for an non-existent job', function (done) {
        ScheduleManager
          .cancelSchedule('0625-6252-7654-9999', CONST.JOB.SCHEDULED_BACKUP)
          .done((jobResponse) => {
            expect(jobResponse).to.eql({});
            expect(schedulerSpy.cancelJob).to.be.calledOnce;
            expect(schedulerSpy.cancelJob.firstCall.args[0][0]).to.eql('0625-6252-7654-9999');
            expect(schedulerSpy.cancelJob.firstCall.args[0][1]).to.eql(jobType);
            expect(repoSpy.delete).to.be.calledOnce;
            expect(repoSpy.delete.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.delete.firstCall.args[0][1]).to.eql(_.set(criteria, 'name', '0625-6252-7654-9999'));
            done();
          });
      });
    });

    describe('#SetupSystemJobs', function () {
      const systemJobConfig = {
        scheduler: {
          system_jobs: [{
              name: 'service-fabrik-mongodb',
              type: 'ScheduledOobDeploymentBackup',
              interval: '0 12 * * *',
              job_data: {
                type: 'online',
                deployment_name: 'service-fabrik-mongodb',
                trigger: 'scheduled',
                container: 'service-fabrik-mongodb'
              }
            },
            {
              name: 'Backup_Reaper',
              type: 'BackupReaper',
              interval: '0 1 * * *',
              job_data: {
                delete_delay: 1000
              }
            },
            {
              name: 'MongoDB',
              type: 'ScheduledOobDeploymentBackup',
              interval: '0 1 * * *',
              enabled: false
            }
          ]
        }
      };
      const ScheduleManager2 = proxyquire('../lib/jobs/ScheduleManager', {
        '../config': systemJobConfig
      });
      const systemUser = CONST.SYSTEM_USER;
      let sandbox, cancelStub, scheduleStub;
      before(function () {
        sandbox = sinon.sandbox.create();
        cancelStub = sandbox.stub(ScheduleManager2, 'cancelSchedule');
        scheduleStub = sandbox.stub(ScheduleManager2, 'schedule');
      });

      afterEach(function () {
        cancelStub.reset();
        scheduleStub.reset();
      });

      after(function () {
        sandbox.restore();
      });

      it('should schedule system jobs in agenda and save it in mongodb successfully', function () {
        ScheduleManager2.setupSystemJobs();
        expect(cancelStub).to.be.calledOnce;
        expect(cancelStub.firstCall.args[0]).to.eql(systemJobConfig.scheduler.system_jobs[2].name);
        expect(cancelStub.firstCall.args[1]).to.eql(systemJobConfig.scheduler.system_jobs[2].type);
        expect(scheduleStub).to.be.calledTwice;
        expect(scheduleStub.firstCall.args[0]).to.eql(systemJobConfig.scheduler.system_jobs[0].name);
        expect(scheduleStub.firstCall.args[1]).to.eql(systemJobConfig.scheduler.system_jobs[0].type);
        expect(scheduleStub.firstCall.args[2]).to.eql(systemJobConfig.scheduler.system_jobs[0].interval);
        expect(scheduleStub.firstCall.args[3]).to.eql(systemJobConfig.scheduler.system_jobs[0].job_data);
        expect(scheduleStub.firstCall.args[4]).to.eql(systemUser);
        expect(scheduleStub.secondCall.args[0]).to.eql(systemJobConfig.scheduler.system_jobs[1].name);
        expect(scheduleStub.secondCall.args[1]).to.eql(systemJobConfig.scheduler.system_jobs[1].type);
        expect(scheduleStub.secondCall.args[2]).to.eql(systemJobConfig.scheduler.system_jobs[1].interval);
        expect(scheduleStub.secondCall.args[3]).to.eql(systemJobConfig.scheduler.system_jobs[1].job_data);
        expect(scheduleStub.secondCall.args[4]).to.eql(systemUser);
      });
    });

  });
});