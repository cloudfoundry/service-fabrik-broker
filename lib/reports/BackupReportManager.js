'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const moment = require('moment-timezone');
const Repository = require('../db').Repository;
const CONST = require('../constants');
const config = require('../config');

class BackupReportManager {
  static getInstanceBackupSummary(instanceId, startTime, endTime) {
    function getJobRunDetailCount(start, end) {
      const criteria = {
        type: CONST.JOB.SCHEDULED_BACKUP,
        'data.instance_id': instanceId,
        createdAt: {
          $gt: start,
          $lt: end
        }
      };
      return Repository.count(CONST.DB_MODEL.JOB_RUN_DETAIL, criteria);
    }

    return Promise
      .all([
        this.getBackupTriggerCount(instanceId, startTime, endTime),
        this.getBackupResult(instanceId, startTime, endTime),
        this.getLastRunDetail(instanceId),
        this.getJobDetails(instanceId),

      ])
      .spread((triggeredBackupCount, resultBackups, lastRunDetail, jobDetail) => {
        const instanceRecord = {};
        const noBackupDays = [];
        //iterator to first entry of the day
        let startIndex = 0;
        let consecutiveBackupFailureCount = 0;
        let currentDay = new Date(startTime);
        let backupSuccessCount = 0;
        // Check if start time is less than instance create time
        return Promise.all([
            Promise.try(() => {
              if (jobDetail) {
                if (startTime <= moment.utc(jobDetail.createdAt).startOf('day').toDate()) {
                  currentDay = moment.utc(jobDetail.createdAt).startOf('day').toDate();
                  //Check if entry present in jobrundetails for current day (start day)
                  getJobRunDetailCount(currentDay, moment.utc(currentDay).endOf('day').toDate())
                    .then(count => {
                      if (!count) {
                        currentDay = moment.utc(currentDay).add(1, 'days').toDate();
                      }
                    });
                }
                _.assign(instanceRecord, {
                  instanceCreateTime: jobDetail.createdAt
                });
              } else {
                currentDay = new Date(endTime);
              }
            }),
            Promise.try(() => {
              if (lastRunDetail && (endTime > lastRunDetail.createdAt)) {
                _.assign(instanceRecord, {
                  instanceDeleteTime: lastRunDetail.createdAt
                });
                endTime = lastRunDetail.createdAt;
                //check if more than one entries present in jobrundetails on delete day
                getJobRunDetailCount(moment.utc(endTime).startOf('day').toDate(), endTime)
                  .then(count => {
                    if (!count) {
                      endTime = moment.utc(endTime).subtract(1, 'days').endOf('day').toDate();
                    }
                  });
              }
            })
          ])
          .then(() => {
            //iterate through list of days and for each day count successful backups
            for (; currentDay < endTime; currentDay = moment(currentDay).add(1, 'days').toDate()) {
              let day_end = endTime < moment(currentDay).add(1, 'days').toDate() ? endTime : moment(currentDay).add(1, 'days').toDate();
              //iterator to last entry on the day
              let endIndex = startIndex;
              while (
                endIndex < resultBackups.length &&
                resultBackups[endIndex].metric === config.monitoring.success_metric &&
                resultBackups[endIndex].createdAt < day_end
              ) {
                endIndex++;
              }
              backupSuccessCount += (endIndex - startIndex);
              if (startIndex === endIndex) {
                noBackupDays.push(currentDay);
              }
              startIndex = endIndex;
            }
            // check consecutive_backup_failure_sla_count failure count
            const maxAllowedNoBackupDaysInRow = config.backup.consecutive_backup_failure_sla_count;
            let windowStartIndex = 0; // start index of consecutive no backup days window
            let windowEndIndex = 0; // end index of consecutive no backup days window
            while (windowEndIndex < noBackupDays.length) {
              while (
                windowEndIndex + 1 < noBackupDays.length &&
                noBackupDays[windowEndIndex].valueOf() === moment(noBackupDays[windowEndIndex + 1]).subtract(1, 'days').toDate().valueOf()
              ) {
                windowEndIndex++;
              }
              consecutiveBackupFailureCount += (windowEndIndex - windowStartIndex + 1) >= maxAllowedNoBackupDaysInRow ? (windowEndIndex - windowStartIndex + 2 - maxAllowedNoBackupDaysInRow) : 0;
              windowEndIndex++;
              windowStartIndex = windowEndIndex;
            }
            const summary = {
              noBackupDays: noBackupDays,
              backupsTriggerred: triggeredBackupCount,
              backupsSucceeded: backupSuccessCount,
              backupFailed: (resultBackups.length - backupSuccessCount),
              failedBackupGuids: resultBackups.slice(backupSuccessCount),
              failureCountForNConsecutiveDays: consecutiveBackupFailureCount
            };
            _.assign(instanceRecord, summary);
            return instanceRecord;
          });
      });
  }

  static getLastRunDetail(instanceId) {
    const criteria = {
      type: CONST.JOB.SCHEDULED_BACKUP,
      'data.instance_id': instanceId,
      'response.delete_backup_status.instance_deleted': true
    };
    return Repository.findOne(CONST.DB_MODEL.JOB_RUN_DETAIL, criteria);
  }

  static getJobDetails(instanceId) {
    const criteria = {
      type: CONST.JOB.SCHEDULED_BACKUP,
      'data.instance_id': instanceId
    };
    return Repository.findOne(CONST.DB_MODEL.JOB, criteria);
  }

  static getInstancesWithBackupScheduled(startTime, endTime) {
    function getInstancesWithBackupScheduled(instanceList, offset, modelName, searchCriteria, paginateOpts) {
      if (offset < 0) {
        return Promise.resolve();
      }
      if (!paginateOpts) {
        paginateOpts = {
          records: config.mongodb.record_max_fetch_count,
          offset: offset
        };
      } else {
        _.chain(paginateOpts)
          .set('offset', offset)
          .value();
      }
      return Repository.search(modelName, searchCriteria, paginateOpts)
        .then((result) => {
          instanceList.push.apply(instanceList, _.map(result.list, 'data'));
          return getInstancesWithBackupScheduled(instanceList, result.nextOffset, modelName, searchCriteria, paginateOpts);
        });
    }
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
    if (endTime) {
      _.assign(criteria.searchBy, {
        createdAt: {
          $lt: endTime
        }
      });
    }
    const paginateOpts = {
      records: config.mongodb.record_max_fetch_count,
      offset: 0
    };
    const result = [];
    return getInstancesWithBackupScheduled(result, 0, CONST.DB_MODEL.JOB, criteria, paginateOpts)
      .then(() => result);
  }

  //startTime and endTime are Date objects
  //Count number of entries present in jobrundetails collection which is how many times scheduler was run/backups were triggered
  static getBackupTriggerCount(instanceId, startTime, endTime) {
    const criteria = {
      type: CONST.JOB.SCHEDULED_BACKUP,
      'data.instance_id': instanceId,
      createdAt: {
        $gt: startTime,
        $lt: endTime
      }
    };
    return Repository.count(CONST.DB_MODEL.JOB_RUN_DETAIL, criteria);
  }

  // Documents of all the succeeded and failed backup entries, sorted first by metric then by create time
  static getBackupResult(instanceId, startTime, endTime) {
    function getBackupResult(resultList, offset, modelName, searchCriteria, paginateOpts) {
      if (offset < 0) {
        return Promise.resolve();
      }
      if (!paginateOpts) {
        paginateOpts = {
          records: config.mongodb.record_max_fetch_count,
          offset: offset
        };
      } else {
        _.chain(paginateOpts)
          .set('offset', offset)
          .value();
      }
      return Repository.search(modelName, searchCriteria, paginateOpts)
        .then((result) => {
          resultList.push.apply(resultList, result.list);
          return getBackupResult(resultList, result.nextOffset, modelName, searchCriteria, paginateOpts);
        });
    }

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
      offset: 0
    };
    const result = [];
    return getBackupResult(result, 0, CONST.DB_MODEL.EVENT_DETAIL, criteria, paginateOpts)
      .then(() => result);
  }
}

module.exports = BackupReportManager;