'use strict';

const moment = require('moment');
const BaseJob = require('../lib/jobs/BaseJob');
const Repository = require('../lib/db').Repository;
const DbCollectionReaperJob = require('../lib/jobs/DbCollectionReaperJob');
const CONST = require('../lib/constants');

describe('Jobs', function () {
  /* jshint expr:true */
  describe('DbCollectionReaperJob', function () {
    const index = mocks.director.networkSegmentIndex;
    const instance_id = mocks.director.uuidByIndex(index);
    let baseJobLogRunHistoryStub, repositoryStub, clockStub;
    const deletResponse = {
      result: {
        n: 10
      }
    };
    before(function () {
      baseJobLogRunHistoryStub = sinon.stub(BaseJob, 'logRunHistory');
      baseJobLogRunHistoryStub.withArgs().returns(Promise.resolve({}));
      repositoryStub = sinon.stub(Repository, 'delete');
      repositoryStub.withArgs().returns(Promise.resolve(deletResponse));
      clockStub = sinon.useFakeTimers(new Date().getTime());
    });
    afterEach(function () {
      baseJobLogRunHistoryStub.reset();
      repositoryStub.reset();
    });
    after(function () {
      baseJobLogRunHistoryStub.restore();
      repositoryStub.restore();
      clockStub.restore();
    });
    const job = {
      attrs: {
        data: {
          reap_collections: [{
            name: 'JobRunDetail',
            retention_in_days: 60
          }, {
            name: 'EventDetail',
            retention_in_days: -1
          }],
          _n_a_m_e_: `${instance_id}_${CONST.JOB.SCHEDULED_BACKUP}`
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

    it('Cleans up configured collections successfully & ignores collections wrongly configured', function () {
      return DbCollectionReaperJob.run(job, () => {})
        .then(() => {
          const expectedJobStatus = [{
            collection: 'JobRunDetail',
            delete_status: deletResponse
          }, {
            collection: 'EventDetail',
            error: `Invalid rention period configured for collection ${job.attrs.data.reap_collections[1].name} : ${job.attrs.data.reap_collections[1].retention_in_days}`
          }];
          expect(repositoryStub).to.be.calledOnce;
          expect(repositoryStub.firstCall.args[0]).to.equal(CONST.DB_MODEL.JOB_RUN_DETAIL);
          let retentionDate = new Date(moment().subtract(job.attrs.data.reap_collections[0].retention_in_days, 'days').toISOString());
          expect(repositoryStub.firstCall.args[1]).to.eql({
            createdAt: {
              $lt: retentionDate
            }
          });
          expect(baseJobLogRunHistoryStub).to.be.calledOnce;
          expect(baseJobLogRunHistoryStub.firstCall.args[0]).to.equal(undefined);
          expect(baseJobLogRunHistoryStub.firstCall.args[1]).to.eql(expectedJobStatus);
        });
    });
  });
});