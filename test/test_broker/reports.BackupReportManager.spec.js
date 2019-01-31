'use strict';
const _ = require('lodash');
const proxyquire = require('proxyquire');
const config = require('../../common/config');
const moment = require('moment-timezone');
const CONST = require('../../common/constants');
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
    request: {
      backup_guid: `${backupGuid}-12121`
    },
    response: 'Response: string',
    metric: metric,
    createdAt: time
  });
};
const repositoryStub = {
  findOne: () => undefined,
  search: () => undefined,
  count: () => undefined
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
let triggeredBackupCount = 14;
for (let i = 0; i < triggeredBackupCount / 2; i++) {
  let time = moment.utc(startTime).add(2, 'hours').add(i, 'days').toDate();
  let backup = getBackup(`${backupGuid}-${i}`, time, 2).value();
  let backup1 = getBackup(`${backupGuid}-1-${i}`, time, 2).value();
  triggeredBackups.push(backup);
  triggeredBackups.push(backup1);
}
let resultBackups = [];
let succeededBackupCount = 5;
let failedBackupCount = 9;
for (let i = 1; i <= succeededBackupCount; i++) {
  let time = moment.utc(startTime).add(2, 'hours').add(i, 'days').toDate();
  let backup = getBackup(`${backupGuid}-${i}`, time, 0).value();
  resultBackups.push(backup);
}
for (let i = 1; i <= failedBackupCount; i++) {
  let time = moment.utc(startTime).add(2, 'hours').add(i, 'days').toDate();
  let backup = getBackup(`${backupGuid}-1-${i}`, time, 1).value();
  resultBackups.push(backup);
}

class Repository {
  static search(model, searchCriteria, paginateOpts) {
    let returnedList = [];
    if (model === CONST.DB_MODEL.JOB) {
      returnedList = listOfInstances;
    } else {
      returnedList = resultBackups;
    }
    repositoryStub.search(arguments);
    return Promise.try(() => {
      let nextOffset = paginateOpts.offset + paginateOpts.records;
      nextOffset = nextOffset >= numOfInstances ? -1 : nextOffset;
      return {
        list: _.slice(returnedList, paginateOpts.offset, paginateOpts.offset + paginateOpts.records),
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

  static count(model, criteria) {
    repositoryStub.count.call(repositoryStub, arguments);
    let returnCount = 0;
    if (criteria.createdAt.$gt === startTime && criteria.createdAt.$lt === endTime) {
      returnCount = triggeredBackupCount;
    }
    return Promise.try(() => returnCount);
  }
}


describe('BackupReportManager', function () {
  const BackupReportManager = proxyquire('../../reports/BackupReportManager', {
    '../common/db': {
      Repository: Repository
    }
  });
  let repoSpy = sinon.stub(repositoryStub);
  let clock;
  before(function () {
    clock = sinon.useFakeTimers();
  });
  afterEach(function () {
    repoSpy.findOne.resetHistory();
    repoSpy.search.resetHistory();
    repoSpy.count.resetHistory();
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
          'data.tenant_id': 1,
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

  describe('#getBackupTriggerCount', function () {
    it('should return count of triggered backups successfully', function () {
      return BackupReportManager.getBackupTriggerCount(instanceId, startTime, endTime)
        .then(count => {
          expect(count).to.eql(triggeredBackupCount);
          expect(repoSpy.count.callCount).to.equal(1);
        });
    });
  });

  describe('#getBackupResult', function () {
    it('should return list of successful and failed backups successfully', function () {
      const criteria = {
        searchBy: {
          eventName: 'create_backup',
          instanceId: instanceId,
          metric: {
            '$ne': config.monitoring.inprogress_metric
          },
          createdAt: {
            '$gte': startTime,
            '$lt': endTime
          }
        },
        projection: {
          metric: 1,
          'request.backup_guid': 1,
          response: 1,
          createdAt: 1
        },
        sortBy: {
          metric: CONST.REPORT_BACKUP.SORT.ASC,
          createdAt: CONST.REPORT_BACKUP.SORT.ASC
        }
      };
      const paginateOpts = {
        records: config.mongodb.record_max_fetch_count,
        offset: config.mongodb.record_max_fetch_count
      };
      return BackupReportManager.getBackupResult(instanceId, startTime, endTime)
        .then(backups => {
          expect(backups).to.deep.eql(resultBackups);
          expect(repoSpy.search.callCount).to.equal(2);
          expect(repoSpy.search.firstCall.args[0][0]).to.be.equal(CONST.DB_MODEL.EVENT_DETAIL);
          expect(repoSpy.search.firstCall.args[0][1]).to.deep.equal(criteria);
          expect(repoSpy.search.firstCall.args[0][2]).to.deep.equal(paginateOpts);

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
          moment.utc(startTime).add(6, 'days').toDate(),
          moment.utc(startTime).add(7, 'days').toDate(),
          moment.utc(startTime).add(8, 'days').toDate(),
          moment.utc(startTime).add(9, 'days').toDate()
        ],
        backupsTriggerred: triggeredBackupCount,
        backupsSucceeded: succeededBackupCount,
        backupFailed: (resultBackups.length - succeededBackupCount),
        failedBackups: resultBackups.slice(succeededBackupCount),
        failureCountForNConsecutiveDays: 2
      };
      return BackupReportManager.getInstanceBackupSummary(instanceId, startTime, endTime)
        .then(summary => {
          expect(summary).to.deep.eql(expectedResult);
          expect(repoSpy.findOne.callCount).to.equal(2);
          expect(repoSpy.search.callCount).to.equal(2);
          expect(repoSpy.count.callCount).to.equal(3);

        });
    });
    it('should return backup summary of instance successfully if failed backups are 0', function () {
      let backupResultTemp = resultBackups;
      let backupsTriggerredTemp = triggeredBackupCount;
      let failedBackupCountTemp = failedBackupCount;
      resultBackups = resultBackups.slice(0, succeededBackupCount);
      failedBackupCount = 0;
      triggeredBackupCount = succeededBackupCount - 2;
      const expectedResult = {
        instanceCreateTime: moment.utc(startTime).toDate(),
        instanceDeleteTime: moment.utc(startTime).add(10, 'days').add(2, 'hours').toDate(),
        noBackupDays: [
          moment.utc(startTime).add(6, 'days').toDate(),
          moment.utc(startTime).add(7, 'days').toDate(),
          moment.utc(startTime).add(8, 'days').toDate(),
          moment.utc(startTime).add(9, 'days').toDate()
        ],
        backupsTriggerred: triggeredBackupCount,
        backupsSucceeded: succeededBackupCount,
        backupFailed: 0,
        failedBackups: [],
        failureCountForNConsecutiveDays: 2
      };
      return BackupReportManager.getInstanceBackupSummary(instanceId, startTime, endTime)
        .then(summary => {
          resultBackups = backupResultTemp;
          triggeredBackupCount = backupsTriggerredTemp;
          failedBackupCount = failedBackupCountTemp;
          expect(summary).to.deep.eql(expectedResult);
          expect(repoSpy.findOne.callCount).to.equal(2);
          expect(repoSpy.search.callCount).to.equal(2);
          expect(repoSpy.count.callCount).to.equal(3);

        });
    });
  });

  describe('#getReportStartTime', function () {
    it('should return correct start time for report if jobdetails are present', function () {
      let jobdetails = {
        createdAt: moment.utc(startTime).add(2, 'hours').toDate()
      };
      let instanceRecord = {};
      const expectedCriteria = {
        type: CONST.JOB.SCHEDULED_BACKUP,
        'data.instance_id': instanceId,
        'response.delete_backup_status.instance_deleted': {
          $ne: true
        },
        createdAt: {
          $gt: moment.utc(startTime).toDate(),
          $lt: moment.utc(startTime).endOf('day').toDate()
        }
      };
      return BackupReportManager.getReportStartTime(instanceId, jobdetails, instanceRecord, startTime)
        .then(startDay => {
          expect(startDay).to.eql(moment.utc(startTime).add(1, 'days').toDate());
          expect(repoSpy.count.firstCall.args[0][0]).to.be.equal(CONST.DB_MODEL.JOB_RUN_DETAIL);
          expect(repoSpy.count.firstCall.args[0][1]).to.deep.equal(expectedCriteria);
          expect(repoSpy.count.callCount).to.equal(1);
        });
    });
    it('should return correct start time for report if jobdetails are not present', function () {
      /*jshint -W080 */
      let jobdetails = undefined;
      let instanceRecord = {};
      return BackupReportManager.getReportStartTime(instanceId, jobdetails, instanceRecord, startTime, endTime)
        .then(startDay => {
          expect(startDay).to.eql(endTime);
        });
    });
  });

  describe('#getReportEndTime', function () {
    it('should return correct end time for report if lastrundetails are present', function () {
      let lastrundetails = {
        createdAt: moment.utc(endTime).subtract(1, 'days').toDate()
      };
      let instanceRecord = {};
      const expectedCriteria = {
        type: CONST.JOB.SCHEDULED_BACKUP,
        'data.instance_id': instanceId,
        'response.delete_backup_status.instance_deleted': {
          $ne: true
        },
        createdAt: {
          $gt: moment.utc(endTime).subtract(1, 'days').startOf('day').toDate(),
          $lt: moment.utc(endTime).subtract(1, 'days').toDate()
        }
      };
      return BackupReportManager.getReportEndTime(instanceId, lastrundetails, instanceRecord, endTime)
        .then(endDay => {
          expect(endDay).to.eql(moment.utc(endTime).subtract(2, 'days').toDate());
          expect(repoSpy.count.firstCall.args[0][0]).to.be.equal(CONST.DB_MODEL.JOB_RUN_DETAIL);
          expect(repoSpy.count.firstCall.args[0][1]).to.deep.equal(expectedCriteria);
          expect(repoSpy.count.callCount).to.equal(1);
        });
    });
    it('should return end start time for report if lastrundetails are not present', function () {
      /*jshint -W080 */
      let lastrundetails = undefined;
      let instanceRecord = {};
      return BackupReportManager.getReportEndTime(instanceId, lastrundetails, instanceRecord, endTime)
        .then(endDay => {
          expect(endDay).to.eql(endTime);
        });
    });
  });


});