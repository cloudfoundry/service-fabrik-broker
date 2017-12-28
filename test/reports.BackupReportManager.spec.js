'use strict';
const _ = require('lodash');
const proxyquire = require('proxyquire');
const config = require('../lib').config;
const moment = require('moment-timezone');
const CONST = require('../lib/constants');
const getInstance = (instanceId) => {
  return Promise.resolve({
    _id: `${instanceId}-12121`,
    data: {
      instance_id: instanceId,
      type: 'online'
    }
  });
};
const getBackup = (backupGuid, time, metric) => {
  return Promise.resolve({
    _id: `${backupGuid}-12121`,
    metric: metric,
    createdAt: time
  });
};
const repositoryStub = {
  aggregate: () => undefined,
  findOne: () => undefined,
  search: () => undefined
};
const startTime = moment.utc(Date.now()).subtract(12, 'days').startOf('day').toDate();
const endTime = moment.utc(startTime).add(12, 'days').endOf('day').toDate();
const instanceId = '9999-8888-7777-6666';
const backupGuid = '9999-8888-7777-5555';
const numOfInstances = 2 * config.mongodb.record_max_fetch_count;
const listOfInstances = [];
for (let i = 1; i <= numOfInstances; i++) {
  let instance = getInstance(`${instanceId}-${i}`).value();
  listOfInstances.push(instance);
}
const triggeredBackups = [];
const triggeredBackupCount = 20;
for (let i = 0; i < triggeredBackupCount / 2; i++) {
  let time = moment.utc(startTime).add(2, 'hours').add(i, 'days').toDate();
  let backup = getBackup(`${backupGuid}-${i}`, time, 2).value();
  let backup1 = getBackup(`${backupGuid}-1-${i}`, time, 2).value();
  triggeredBackups.push(backup);
  triggeredBackups.push(backup1);
}
const resultBackups = [];
const succeededBackupCount = 7;
const failedBackupCount = 10;
for (let i = 0; i < succeededBackupCount; i++) {
  let time = moment.utc(startTime).add(2, 'hours').add(i, 'days').toDate();
  let backup = getBackup(`${backupGuid}-${i}`, time, 0).value();
  resultBackups.push(backup);
}
for (let i = 0; i < failedBackupCount; i++) {
  let time = moment.utc(startTime).add(2, 'hours').add(i, 'days').toDate();
  let backup = getBackup(`${backupGuid}-1-${i}`, time, 1).value();
  resultBackups.push(backup);
}

class Repository {
  static search(model, searchCriteria, paginateOpts) {
    repositoryStub.search(arguments);
    return Promise.try(() => {
      let nextOffset = paginateOpts.offset + paginateOpts.records;
      nextOffset = nextOffset >= numOfInstances ? -1 : nextOffset;
      return {
        list: _.slice(listOfInstances, paginateOpts.offset, paginateOpts.offset + paginateOpts.records),
        totalRecordCount: 10,
        nextOffset: nextOffset
      };
    });
  }

  static findOne(model) {
    repositoryStub.findOne.call(repositoryStub, arguments);
    let time;
    if (model === CONST.DB_MODEL.JOB_RUN_DETAIL) {
      time = moment.utc(startTime).add(10, 'days').add(2, 'hours').toDate();
    } else {
      time = moment.utc(startTime).toDate();
    }
    return Promise.resolve({
      createdAt: time
    });
  }

  static aggregate(model, aggregateCriteria) {
    repositoryStub.aggregate.call(repositoryStub, arguments);
    if (aggregateCriteria[0].$match.metric === 2) {
      return Promise.try(() => triggeredBackups);
    }
    return Promise.try(() => resultBackups);
  }
}


describe('BackupReportManager', function () {
  const BackupReportManager = proxyquire('../lib/reports/BackupReportManager', {
    '../db': {
      Repository: Repository
    }
  });
  let repoSpy = sinon.stub(repositoryStub);
  let clock;
  before(function () {
    clock = sinon.useFakeTimers();
  });
  afterEach(function () {
    repoSpy.findOne.reset();
    repoSpy.aggregate.reset();
    repoSpy.search.reset();
    clock.reset();
  });
  after(function () {
    clock.restore();
  });

  describe('#getInstancesWithBackupScheduled', function () {
    it('should return list of instances with backup scheduled successfully', function () {
      const expectedInstanceList = [];
      expectedInstanceList.push.apply(expectedInstanceList, _.map(listOfInstances, 'data'));
      const criteria = {
        searchBy: {
          type: CONST.JOB.SCHEDULED_BACKUP
        },
        projection: {
          'data.instance_id': 1,
          'data.service_name': 1,
          'data.instance_name': 1,
          'data.plan_id': 1,
          'data.service_plan_name': 1,
          'data.space_guid': 1,
          'data.space_name': 1,
          'data.organization_guid': 1,
          'data.organization_name': 1
        }
      };
      const paginateOpts = {
        records: config.mongodb.record_max_fetch_count,
        offset: config.mongodb.record_max_fetch_count
      };

      return BackupReportManager
        .getInstancesWithBackupScheduled()
        .then(instances => {
          expect(instances).to.eql(expectedInstanceList);
          expect(repoSpy.search.callCount).to.equal(2);
          expect(repoSpy.search.firstCall.args[0][0]).to.be.equal(CONST.DB_MODEL.JOB);
          expect(repoSpy.search.firstCall.args[0][1]).to.deep.equal(criteria);
          expect(repoSpy.search.firstCall.args[0][2]).to.deep.equal(paginateOpts);
        });
    });
  });

  describe('#getBackupTriggerRecord', function () {
    it('should return list of triggered backups successfully', function () {
      return BackupReportManager.getBackupTriggerRecord(instanceId, startTime, endTime)
        .then(triggeredBackup => {
          expect(triggeredBackup).to.deep.eql(triggeredBackups);
          expect(repoSpy.aggregate.callCount).to.equal(1);
        });
    });
  });

  describe('#getBackupResult', function () {
    it('should return list of successful and failed backups successfully', function () {
      return BackupReportManager.getBackupResult(instanceId, startTime, endTime)
        .then(backup => {
          expect(backup).to.deep.eql(resultBackups);
          expect(repoSpy.aggregate.callCount).to.equal(1);
        });
    });
  });

  describe('#getLastRunDetail', function () {
    it('should return last run detail of instance successfully', function () {
      const expectedResult = {
        createdAt: moment.utc(startTime).add(10, 'days').add(2, 'hours').toDate()
      };
      return BackupReportManager.getLastRunDetail(instanceId)
        .then(lastRunDetail => {
          expect(lastRunDetail).to.deep.eql(expectedResult);
          expect(repoSpy.findOne.callCount).to.equal(1);
        });
    });
  });

  describe('#getJobDetails', function () {
    it('should return job details of instance successfully', function () {
      const expectedResult = {
        createdAt: moment.utc(startTime).toDate()
      };
      return BackupReportManager.getJobDetails(instanceId)
        .then(jobDetail => {
          expect(jobDetail).to.deep.eql(expectedResult);
          expect(repoSpy.findOne.callCount).to.equal(1);
        });
    });
  });

  describe('#getInstanceBackupSummary', function () {
    it('should return backup summary of instance successfully', function () {
      const expectedResult = {
        instanceCreateTime: moment.utc(startTime).toDate(),
        instanceDeleteTime: moment.utc(startTime).add(10, 'days').add(2, 'hours').toDate(),
        noBackupDays: [
          moment.utc(startTime).add(7, 'days').toDate(),
          moment.utc(startTime).add(8, 'days').toDate(),
          moment.utc(startTime).add(9, 'days').toDate(),
          moment.utc(startTime).add(10, 'days').toDate(),
        ],
        backupsTriggerred: triggeredBackupCount,
        backupsSucceeded: succeededBackupCount,
        backupFailed: (resultBackups.length - succeededBackupCount),
        failedBackupGuids: resultBackups.slice(succeededBackupCount),
        failureCountForNConsecutiveDays: 2
      };
      return BackupReportManager.getInstanceBackupSummary(instanceId, startTime, endTime)
        .then(summary => {
          expect(summary).to.deep.eql(expectedResult);
          expect(repoSpy.findOne.callCount).to.equal(2);
          expect(repoSpy.aggregate.callCount).to.equal(2);
        });
    });
  });

});
