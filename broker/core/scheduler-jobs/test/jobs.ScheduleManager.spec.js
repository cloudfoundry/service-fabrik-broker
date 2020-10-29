'use strict';

const _ = require('lodash');
const proxyquire = require('proxyquire');
const pubsub = require('pubsub-js');
const {
  CONST,
  errors: {
    DBUnavailable,
    BadRequest,
    NotFound
  },
  commonFunctions
} = require('@sf/common-utils');
const Repo = require('@sf/common-utils').Repository;

const instance_id = '9999-8888-7777-6666';
let jobType = CONST.JOB.SCHEDULED_BACKUP;
const interval = '*/1 * * * *';
const createdAt = new Date();
const updatedAt = new Date();
const lastRunAt = new Date();
const nextRunAt = new Date();
const dbStartedAt = new Date();
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
  lastRunAt: dbStartedAt,
  nextRunAt: nextRunAt,
  lockedAt: lockedAt,
  repeatInterval: interval,
  repeatTimezone: jobData.timeZone,
  createdBy: user.email,
  updatedBy: user.email,
  createdAt: createdAt,
  updatedAt: updatedAt,
  lastRunDetails: {
    lastRunAt: dbStartedAt,
    status: CONST.OPERATION.SUCCEEDED
  }
};
const schedulerStub = {
  schedule: () => undefined,
  getJob: () => undefined,
  runAt: () => undefined,
  runNow: () => undefined,
  cancelJob: () => undefined,
  purgeOldFinishedJobs: () => undefined
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

  runNow(name, type, data) {
    schedulerStub.runNow.call(schedulerStub, arguments);
    return Promise.resolve({
      name: type,
      data: _.omit(data, 'timeZone'),
      lastRunAt: lastRunAt,
      nextRunAt: nextRunAt,
      repeatInterval: 'now',
      lockedAt: null,
      repeatTimezone: data.timeZone
    });
  }

  getJob(name, type) {
    schedulerStub.getJob(arguments);
    if (name !== instance_id) {
      return Promise.resolve(null);
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

  purgeOldFinishedJobs() {
    schedulerStub.purgeOldFinishedJobs.call(schedulerStub, arguments);
    return Promise.resolve({});
  }
}

let DbDown = false;
const DbUnavailable = new DBUnavailable('DB Down..Simulated Expected error..');
const DELETE_RESPONSE = {
  result: {
    n: 10
  }
};
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
    return Promise.try(() => {
      repositoryStub.delete.call(repositoryStub, arguments);
      if (DbDown) {
        throw DbUnavailable;
      }
      return DELETE_RESPONSE;
    });
  }

  static search() {
    return Promise.try(() => {
      return null;
    });
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
  const ScheduleManager = proxyquire('../src/ScheduleManager', {
    './Scheduler': Scheduler,
    '@sf/common-utils': {
      Repository: Repository
    }
  });
  /* jshint expr:true */
  describe('ScheduleManager', function () {
    let schedulerSpy = sinon.stub(schedulerStub);
    let repoSpy = sinon.stub(repositoryStub);
    const lastRunStatus = {
      name: instance_id,
      type: CONST.JOB.SERVICE_INSTANCE_UPDATE,
      interval: '12 12 * * *',
      data: {
        instance_id: instance_id,
        attempt: 1,
        _n_a_m_e_: `${instance_id}_${CONST.JOB.SERVICE_INSTANCE_UPDATE}`
      },
      response: {
        diff: [{
          releases: {}
        }]
      },
      statusCode: CONST.JOB_RUN_STATUS_CODE.SUCCEEDED,
      statusMessage: 'run successful',
      startedAt: dbStartedAt,
      createdAt: new Date(),
      createdBy: 'SYSTEM',
      processedBy: 'MAC1'
    };

    let clock, randomIntStub, repoSinonStub;
    before(function () {
      clock = sinon.useFakeTimers();
      randomIntStub = sinon.stub(commonFunctions, 'getRandomInt').callsFake(() => 0);
      // randomIntStub = sinon.stub(utils, 'getRandomInt', (min, max) => (randomize ? randomInt(min, max) : 1));
      repoSinonStub = sinon.stub(Repo, 'search').callsFake(() => {
        return Promise.try(() => {
          const runStatus = _.cloneDeep(lastRunStatus);
          runStatus.response.diff = [];
          runStatus.data.attempt = 2;
          return {
            list: [runStatus, lastRunStatus],
            totalRecordCount: 2,
            nextOffset: -1
          };
        });
      });
    });

    afterEach(function () {
      schedulerSpy.schedule.resetHistory();
      schedulerSpy.runAt.resetHistory();
      schedulerSpy.getJob.resetHistory();
      schedulerSpy.cancelJob.resetHistory();
      schedulerSpy.purgeOldFinishedJobs.resetHistory();
      repoSpy.saveOrUpdate.resetHistory();
      repoSpy.findOne.resetHistory();
      repoSpy.delete.resetHistory();
      clock.reset();
    });

    after(function () {
      clock.restore();
      randomIntStub.restore();
      repoSinonStub.restore();
    });
    describe('#ScheduleJobs', function () {
      it('should schedule a job in agenda and save it in mongodb successfully', function () {
        return ScheduleManager
          .schedule(instance_id, CONST.JOB.SCHEDULED_BACKUP, interval, jobData, user)
          .then(jobResponse => {
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
              data: jobData,
              runOnlyOnce: false
            };
            expect(repoSpy.saveOrUpdate).to.be.calledOnce;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][1]).to.eql(jobToBeSavedInDB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][2]).to.eql(criteria);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][3]).to.eql(user);
          });
      });
      it('should throw an error when incorrect hourly human format is input', function () {
        return ScheduleManager
          .schedule(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE, 'blah hours', jobData, user)
          .then(() => {
            throw 'Test should have thrown an error, but it did not!';
          })
          .catch(BadRequest, () => {});
      });
      it('should schedule a job with random hourly schedule when input with human interval of hrs and save it in mongodb successfully', function () {
        return ScheduleManager
          .schedule(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE, '8 hours', jobData, user)
          .then(jobResponse => {
            const expectedRandomInterval = '0 0,8,16 * * *';
            const mergedJobServInsUpd = _.clone(mergedJob);
            mergedJobServInsUpd.name = `${instance_id}_${CONST.JOB.SERVICE_INSTANCE_UPDATE}`;
            mergedJobServInsUpd.lastRunAt = dbStartedAt;
            mergedJobServInsUpd.repeatInterval = expectedRandomInterval;
            mergedJobServInsUpd.lastRunDetails = {
              status: CONST.OPERATION.SUCCEEDED,
              lastRunAt: dbStartedAt,
              diff: {
                after: [],
                before: lastRunStatus.response.diff
              }
            };
            expect(jobResponse).to.eql(mergedJobServInsUpd);
            expect(schedulerSpy.schedule).to.be.calledOnce;
            expect(schedulerSpy.schedule.firstCall.args[0][0]).to.be.equal(instance_id);
            expect(schedulerSpy.schedule.firstCall.args[0][1]).to.be.equal(CONST.JOB.SERVICE_INSTANCE_UPDATE);
            expect(schedulerSpy.schedule.firstCall.args[0][2]).to.be.equal(expectedRandomInterval);
            expect(schedulerSpy.schedule.firstCall.args[0][3]).to.eql(jobData);
            const jobToBeSavedInDB = {
              name: instance_id,
              type: CONST.JOB.SERVICE_INSTANCE_UPDATE,
              interval: expectedRandomInterval,
              data: jobData,
              runOnlyOnce: false
            };
            expect(repoSpy.saveOrUpdate).to.be.calledOnce;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][1]).to.eql(jobToBeSavedInDB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][2]).to.eql({
              name: instance_id,
              type: CONST.JOB.SERVICE_INSTANCE_UPDATE
            });
            expect(repoSpy.saveOrUpdate.firstCall.args[0][3]).to.eql(user);
          });
      });
      it('should schedule a job with input human interval of x hrs (where multiple of x!=24) and save it in mongodb successfully', function () {
        return ScheduleManager
          .schedule(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE, '7 hours', jobData, user)
          .then(jobResponse => {
            const expectedRandomInterval = '7 hours';
            const mergedJobServInsUpd = _.clone(mergedJob);
            mergedJobServInsUpd.name = `${instance_id}_${CONST.JOB.SERVICE_INSTANCE_UPDATE}`;
            mergedJobServInsUpd.lastRunAt = dbStartedAt;
            mergedJobServInsUpd.repeatInterval = expectedRandomInterval;
            mergedJobServInsUpd.lastRunDetails = {
              status: CONST.OPERATION.SUCCEEDED,
              lastRunAt: dbStartedAt,
              diff: {
                after: [],
                before: lastRunStatus.response.diff
              }
            };
            expect(jobResponse).to.eql(mergedJobServInsUpd);
            expect(schedulerSpy.schedule).to.be.calledOnce;
            expect(schedulerSpy.schedule.firstCall.args[0][0]).to.be.equal(instance_id);
            expect(schedulerSpy.schedule.firstCall.args[0][1]).to.be.equal(CONST.JOB.SERVICE_INSTANCE_UPDATE);
            expect(schedulerSpy.schedule.firstCall.args[0][2]).to.be.equal(expectedRandomInterval);
            expect(schedulerSpy.schedule.firstCall.args[0][3]).to.eql(jobData);
            const jobToBeSavedInDB = {
              name: instance_id,
              type: CONST.JOB.SERVICE_INSTANCE_UPDATE,
              interval: expectedRandomInterval,
              data: jobData,
              runOnlyOnce: false
            };
            expect(repoSpy.saveOrUpdate).to.be.calledOnce;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][1]).to.eql(jobToBeSavedInDB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][2]).to.eql({
              name: instance_id,
              type: CONST.JOB.SERVICE_INSTANCE_UPDATE
            });
            expect(repoSpy.saveOrUpdate.firstCall.args[0][3]).to.eql(user);
          });
      });
      it('should schedule a job with random schedule and save it in mongodb successfully', function () {
        return ScheduleManager
          .schedule(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE, CONST.SCHEDULE.RANDOM, jobData, user)
          .then(jobResponse => {
            const expectedRandomInterval = '0 0 * * 0';
            const mergedJobServInsUpd = _.clone(mergedJob);
            mergedJobServInsUpd.name = `${instance_id}_${CONST.JOB.SERVICE_INSTANCE_UPDATE}`;
            mergedJobServInsUpd.lastRunAt = dbStartedAt;
            mergedJobServInsUpd.repeatInterval = expectedRandomInterval;
            mergedJobServInsUpd.lastRunDetails = {
              status: CONST.OPERATION.SUCCEEDED,
              lastRunAt: dbStartedAt,
              diff: {
                after: [],
                before: lastRunStatus.response.diff
              }
            };
            expect(jobResponse).to.eql(mergedJobServInsUpd);
            expect(schedulerSpy.schedule).to.be.calledOnce;
            expect(schedulerSpy.schedule.firstCall.args[0][0]).to.be.equal(instance_id);
            expect(schedulerSpy.schedule.firstCall.args[0][1]).to.be.equal(CONST.JOB.SERVICE_INSTANCE_UPDATE);
            expect(schedulerSpy.schedule.firstCall.args[0][2]).to.be.equal(expectedRandomInterval);
            expect(schedulerSpy.schedule.firstCall.args[0][3]).to.eql(jobData);
            const jobToBeSavedInDB = {
              name: instance_id,
              type: CONST.JOB.SERVICE_INSTANCE_UPDATE,
              interval: expectedRandomInterval,
              data: jobData,
              runOnlyOnce: false
            };
            expect(repoSpy.saveOrUpdate).to.be.calledOnce;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][1]).to.eql(jobToBeSavedInDB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][2]).to.eql({
              name: instance_id,
              type: CONST.JOB.SERVICE_INSTANCE_UPDATE
            });
            expect(repoSpy.saveOrUpdate.firstCall.args[0][3]).to.eql(user);
          });
      });
      it('should schedule a job in agenda with daily random schedule and save it in mongodb successfully', function () {
        return ScheduleManager
          .scheduleDaily(instance_id, CONST.JOB.SCHEDULED_BACKUP, jobData, user)
          .then(jobResponse => {
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
              data: jobData,
              runOnlyOnce: false
            };
            expect(repoSpy.saveOrUpdate).to.be.calledOnce;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][1]).to.eql(jobToBeSavedInDB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][2]).to.eql(criteria);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][3]).to.eql(user);
          });
      });
      it('should schedule a job in agenda and save it in mongodb successfully at specified time', function () {
        const scheduleAt = '10 mins from now';
        return ScheduleManager
          .runAt(instance_id, CONST.JOB.SCHEDULED_BACKUP, scheduleAt, jobData, user)
          .then(jobResponse => {
            const expectedResponse = _.cloneDeep(mergedJob);
            delete expectedResponse.lastRunDetails;
            expectedResponse.repeatInterval = scheduleAt;
            expect(jobResponse).to.eql(expectedResponse);
            expect(schedulerSpy.runAt).to.be.calledOnce;
            expect(schedulerSpy.runAt.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.runAt.firstCall.args[0][1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
            expect(schedulerSpy.runAt.firstCall.args[0][2]).to.eql(scheduleAt);
            expect(schedulerSpy.runAt.firstCall.args[0][3]).to.eql(jobData);
            const jobToBeSavedInDB = {
              name: instance_id,
              type: `${jobType}_0`,
              interval: scheduleAt,
              data: jobData,
              runOnlyOnce: true
            };
            expect(repoSpy.saveOrUpdate).to.be.calledOnce;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][1]).to.eql(jobToBeSavedInDB);
            const expectedCriteria = _.clone(criteria);
            expectedCriteria.type = `${CONST.JOB.SCHEDULED_BACKUP}_0`;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][2]).to.eql(expectedCriteria);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][3]).to.eql(user);
          });
      });
      it('should schedule a job in agenda and save it in mongodb successfully at current time', function () {
        const scheduleAt = 'now';
        return ScheduleManager
          .runNow(instance_id, CONST.JOB.SCHEDULED_BACKUP, jobData, user)
          .then(jobResponse => {
            const expectedResponse = _.cloneDeep(mergedJob);
            delete expectedResponse.lastRunDetails;
            expectedResponse.repeatInterval = scheduleAt;
            expect(jobResponse).to.eql(expectedResponse);
            expect(schedulerSpy.runNow).to.be.calledOnce;
            expect(schedulerSpy.runNow.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.runNow.firstCall.args[0][1]).to.eql(CONST.JOB.SCHEDULED_BACKUP);
            expect(schedulerSpy.runNow.firstCall.args[0][2]).to.eql(jobData);
            const jobToBeSavedInDB = {
              name: instance_id,
              type: `${jobType}_0`,
              interval: scheduleAt,
              data: jobData,
              runOnlyOnce: true
            };
            expect(repoSpy.saveOrUpdate).to.be.calledOnce;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][1]).to.eql(jobToBeSavedInDB);
            const expectedCriteria = _.clone(criteria);
            expectedCriteria.type = `${CONST.JOB.SCHEDULED_BACKUP}_0`;
            expect(repoSpy.saveOrUpdate.firstCall.args[0][2]).to.eql(expectedCriteria);
            expect(repoSpy.saveOrUpdate.firstCall.args[0][3]).to.eql(user);
          });
      });
    });

    describe('#getJobSchedule', function () {
      it('should return the job schedule for scheduled job by merging job details from agenda & mongodb successfully', function () {
        return ScheduleManager
          .getSchedule(instance_id, CONST.JOB.SCHEDULED_BACKUP)
          .then(jobResponse => {
            expect(jobResponse).to.eql(mergedJob);
            expect(schedulerSpy.getJob).to.be.calledOnce;
            expect(schedulerSpy.getJob.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.getJob.firstCall.args[0][1]).to.eql(jobType);
            expect(repoSpy.findOne).to.be.calledOnce;
            expect(repoSpy.findOne.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.findOne.firstCall.args[0][1]).to.eql(criteria);
          });
      });
      it('should error when queried for schedule for a job which is not yet scheduled', function () {
        return ScheduleManager
          .getSchedule('0625-6252-7654-9999', CONST.JOB.SCHEDULED_BACKUP)
          .catch(NotFound, () => {
            expect(schedulerSpy.getJob).to.be.calledOnce;
            expect(schedulerSpy.getJob.firstCall.args[0][0]).to.eql('0625-6252-7654-9999');
            expect(schedulerSpy.getJob.firstCall.args[0][1]).to.eql(jobType);
            expect(repoSpy.findOne).not.to.be.called;
          });
      });
      it('should return even the last run status for job types which can return the same', function () {
        return ScheduleManager
          .getSchedule(instance_id, CONST.JOB.SERVICE_INSTANCE_UPDATE)
          .then(jobResponse => {
            const mergedJobServInsUpd = _.clone(mergedJob);
            mergedJobServInsUpd.name = `${instance_id}_${CONST.JOB.SERVICE_INSTANCE_UPDATE}`;
            mergedJobServInsUpd.lastRunAt = dbStartedAt;
            mergedJobServInsUpd.lastRunDetails = {
              status: CONST.OPERATION.SUCCEEDED,
              lastRunAt: dbStartedAt,
              diff: {
                before: lastRunStatus.response.diff,
                after: []
              }
            };
            expect(jobResponse).to.eql(mergedJobServInsUpd);
            expect(schedulerSpy.getJob).to.be.calledOnce;
            expect(schedulerSpy.getJob.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.getJob.firstCall.args[0][1]).to.eql(CONST.JOB.SERVICE_INSTANCE_UPDATE);
            expect(repoSpy.findOne).to.be.calledOnce;
            expect(repoSpy.findOne.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.findOne.firstCall.args[0][1]).to.eql({
              name: instance_id,
              type: CONST.JOB.SERVICE_INSTANCE_UPDATE
            });
          });
      });
    });

    describe('#cancelJobSchedule', function () {
      it('should cancel the schedule for only repeat job (not all jobs) in agenda and delete the job from mongodb successfully', function () {
        return ScheduleManager
          .cancelSchedule(instance_id, CONST.JOB.SCHEDULED_BACKUP)
          .then(jobResponse => {
            expect(jobResponse).to.eql(DELETE_RESPONSE);
            expect(schedulerSpy.cancelJob).to.be.calledOnce;
            expect(schedulerSpy.cancelJob.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.cancelJob.firstCall.args[0][1]).to.eql(jobType);
            expect(schedulerSpy.cancelJob.firstCall.args[0][2]).to.eql(undefined);
            expect(repoSpy.delete).to.be.calledOnce;
            expect(repoSpy.delete.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.delete.firstCall.args[0][1]).to.eql(criteria);
          });
      });

      it('should cancel the schedule for all jobs in agenda and delete the job from mongodb successfully', function () {
        const cancelAllJobs = true;
        const criteria = {
          name: instance_id,
          type: {
            $regex: `^${jobType}.*`
          }
        };
        return ScheduleManager
          .cancelSchedule(instance_id, CONST.JOB.SCHEDULED_BACKUP, cancelAllJobs)
          .then(jobResponse => {
            expect(jobResponse).to.eql(DELETE_RESPONSE);
            expect(schedulerSpy.cancelJob).to.be.calledOnce;
            expect(schedulerSpy.cancelJob.firstCall.args[0][0]).to.eql(instance_id);
            expect(schedulerSpy.cancelJob.firstCall.args[0][1]).to.eql(jobType);
            expect(schedulerSpy.cancelJob.firstCall.args[0][2]).to.eql(true);
            expect(repoSpy.delete).to.be.calledOnce;
            expect(repoSpy.delete.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.delete.firstCall.args[0][1]).to.eql(criteria);
          });
      });

      it('should not error if cancel job is requested for an non-existent job', function () {
        return ScheduleManager
          .cancelSchedule('0625-6252-7654-9999', CONST.JOB.SCHEDULED_BACKUP)
          .then(jobResponse => {
            expect(jobResponse).to.eql(DELETE_RESPONSE);
            expect(schedulerSpy.cancelJob).to.be.calledOnce;
            expect(schedulerSpy.cancelJob.firstCall.args[0][0]).to.eql('0625-6252-7654-9999');
            expect(schedulerSpy.cancelJob.firstCall.args[0][1]).to.eql(jobType);
            expect(schedulerSpy.cancelJob.firstCall.args[0][2]).to.eql(undefined);
            expect(repoSpy.delete).to.be.calledOnce;
            expect(repoSpy.delete.firstCall.args[0][0]).to.eql(CONST.DB_MODEL.JOB);
            expect(repoSpy.delete.firstCall.args[0][1]).to.eql(_.set(criteria, 'name', '0625-6252-7654-9999'));
          });
      });
    });

    describe('#PurgeOldJobs', function () {
      it('should purge old finished jobs successfully', function () {
        return ScheduleManager
          .purgeOldFinishedJobs()
          .then(response => {
            const expectedResponse = {
              collection: CONST.DB_MODEL.JOB,
              delete_count: DELETE_RESPONSE.result.n
            };
            expect(response).to.eql(expectedResponse);
          });
      });
      it('should gracefully return even in case of errors while purging', function () {
        DbDown = true;
        return ScheduleManager
          .purgeOldFinishedJobs()
          .then(response => {
            DbDown = false;
            const expectedResponse = {
              collection: CONST.DB_MODEL.JOB,
              error: DbUnavailable.reason || DbUnavailable.message
            };
            expect(response).to.eql(expectedResponse);
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
      let ScheduleManager2;
      const systemUser = CONST.SYSTEM_USER;

      let sandbox, cancelStub, scheduleStub, subStub, startSchedulerHandler, getScheduleStub, notFound;
      before(function () {
        sandbox = sinon.createSandbox();
        subStub = sandbox.stub(pubsub, 'subscribe').callsFake((topicName, handler) => topicName === CONST.TOPIC.SCHEDULER_STARTED ?
          startSchedulerHandler = handler : {});
        ScheduleManager2 = proxyquire('../src/ScheduleManager', {
          '@sf/app-config': systemJobConfig
        });
        cancelStub = sandbox.stub(ScheduleManager2, 'cancelSchedule');
        scheduleStub = sandbox.stub(ScheduleManager2, 'schedule');
        getScheduleStub = sandbox.stub(ScheduleManager2, 'getSchedule').callsFake(name => {
          return Promise.try(() => {
            if (notFound) {
              return {};
            } else {
              return {
                repeatInterval: _.filter(systemJobConfig.scheduler.system_jobs, item => item.name === name)[0].interval
              };
            }
          });
        });

      });
      afterEach(function () {
        cancelStub.resetHistory();
        scheduleStub.resetHistory();
        getScheduleStub.resetHistory();
        notFound = false;
      });
      after(function () {
        sandbox.restore();
      });

      it('should schedule system jobs in agenda and save it in mongodb successfully', function () {
        notFound = true;
        return startSchedulerHandler()
          .then(() => {
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
      it('should not schedule system jobs if they are already scheduled', function () {
        return startSchedulerHandler()
          .then(() => {
            expect(cancelStub).to.be.calledOnce;
            expect(cancelStub.firstCall.args[0]).to.eql(systemJobConfig.scheduler.system_jobs[2].name);
            expect(cancelStub.firstCall.args[1]).to.eql(systemJobConfig.scheduler.system_jobs[2].type);
            expect(scheduleStub).not.to.be.called;
          });
      });
    });
  });
});
