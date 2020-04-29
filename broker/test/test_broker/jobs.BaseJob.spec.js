'use strict';

const _ = require('lodash');
const BaseJob = require('../../core/scheduler-jobs/src/jobs/BaseJob');
const {
  CONST,
  Repository
} = require('@sf/common-utils');

describe('Jobs', function () {
  describe('BaseJob', function () {
    /* jshint expr:true */
    const index = mocks.director.networkSegmentIndex;
    const instance_id = mocks.director.uuidByIndex(index);
    const service_id = '24731fb8-7b84-4f57-914f-c3d55d793dd4';
    const plan_id = 'bc158c9a-7934-401e-94ab-057082a5073f';
    const space_guid = 'e7c0a437-7585-4d75-addf-aa4d45b49f3a';
    const job = {
      attrs: {
        name: CONST.JOB.SCHEDULED_BACKUP,
        data: {
          instance_id: instance_id,
          type: 'online',
          trigger: CONST.BACKUP.TRIGGER.SCHEDULED,
          space_guid: space_guid,
          service_id: service_id,
          plan_id: plan_id,
          _n_a_m_e_: `${instance_id}_${CONST.JOB.SCHEDULED_BACKUP}`
        },
        lastRunAt: new Date(),
        nextRunAt: new Date(),
        repeatInterval: '*/1 * * * *',
        lockedAt: null,
        repeatTimezone: 'America/New_York'
      },
      fail: () => undefined,
      save: () => undefined,
      __started_At: new Date()
    };
    const options = job.attrs.data;
    const jobType = _.split(job.attrs.name, '_').pop();
    const successJobResponse = {
      status: 'succeeded'
    };
    const failureJobResponse = {
      status: 'error occurred during backup'
    };
    const err = {
      statusCode: '100',
      statusMessage: 'Quota exceeded'
    };
    const err2 = {
      statusCode: '101',
      statusMessage: 'DB Down'
    };
    const expectedJobRunDetail = {
      name: options.instance_id,
      interval: job.attrs.repeatInterval,
      type: jobType,
      data: options,
      response: undefined,
      statusCode: undefined,
      statusMessage: undefined,
      startedAt: job.__started_At,
      processedBy: BaseJob.getProcessId()
    };
    const user = {
      name: 'Hugo'
    };
    const systemUser = CONST.SYSTEM_USER;

    describe('#LogRunHistory', function () {
      let repositorySaveStub;

      before(function () {
        repositorySaveStub = sinon.stub(Repository, 'save');
      });

      afterEach(function () {
        repositorySaveStub.resetHistory();
      });

      after(function () {
        repositorySaveStub.restore();
      });

      it('should log the success job run in history successfully', function () {
        expectedJobRunDetail.response = successJobResponse;
        expectedJobRunDetail.statusCode = '0';
        expectedJobRunDetail.statusMessage = 'run successful';
        repositorySaveStub.withArgs().returns(Promise.resolve({}));
        return BaseJob.logRunHistory(undefined, successJobResponse, job, user).then(() => {
          expect(repositorySaveStub).to.be.calledOnce;
          expect(repositorySaveStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.JOB_RUN_DETAIL);
          expect(repositorySaveStub.firstCall.args[1]).to.deep.equal(expectedJobRunDetail);
          expect(repositorySaveStub.firstCall.args[2]).to.eql(user);
        });
      });
      it('should log the failed job run in history successfully', function () {
        expectedJobRunDetail.response = {
          error: err,
          jobStatus: failureJobResponse
        };
        expectedJobRunDetail.statusCode = err.statusCode;
        expectedJobRunDetail.statusMessage = err.statusMessage;
        repositorySaveStub.withArgs().returns(Promise.resolve({}));
        return BaseJob.logRunHistory(err, failureJobResponse, job).then(() => {
          expect(repositorySaveStub).to.be.calledOnce;
          expect(repositorySaveStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.JOB_RUN_DETAIL);
          expect(repositorySaveStub.firstCall.args[1]).to.deep.equal(expectedJobRunDetail);
          expect(repositorySaveStub.firstCall.args[2]).to.eql(systemUser);
        });
      });
      it('should gracefully handle scenarios when saving to db fails', function () {
        expectedJobRunDetail.response = {
          error: err2,
          jobStatus: failureJobResponse
        };
        expectedJobRunDetail.statusCode = err2.statusCode;
        expectedJobRunDetail.statusMessage = err2.statusMessage;
        repositorySaveStub.withArgs().returns(Promise.try(() => {
          throw new Error('Db unreachable');
        }));
        return BaseJob.logRunHistory(err2, failureJobResponse, job).then(responseCode => {
          expect(repositorySaveStub).to.be.calledOnce;
          expect(repositorySaveStub.firstCall.args[0]).to.eql(CONST.DB_MODEL.JOB_RUN_DETAIL);
          expect(repositorySaveStub.firstCall.args[1]).to.deep.equal(expectedJobRunDetail);
          expect(repositorySaveStub.firstCall.args[2]).to.eql(systemUser);
          expect(responseCode).to.eql(-1);
        });
      });
    });
  });
});
