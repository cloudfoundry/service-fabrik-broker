'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const moment = require('moment-timezone');
const Repository = require('../db').Repository;
const CONST = require('../constants');
const config = require('../config');
class BackupReportManager {
  static createInstanceBackupRecord(instance_id, start_time, end_time) {
    return Promise
      .all([
        this.getBackupTriggerRecord(instance_id, start_time, end_time),
        this.getBackupResult(instance_id, start_time, end_time),
        this.getInstanceDeleteTime(instance_id),
        this.getInstanceCreateTime(instance_id)
      ])
      .spread((triggeredBackups, resultBackups, instanceDeleteTime, instanceCreateTime) => {
        const instance_record = {};
        const noBackupDays = [];
        //start index in resultBackuplist
        let start_index = 0;
        let threeBackupFailureCount = 0;
        let currentDay = new Date(start_time);
        let lastFailDay;
        let secondlastFailDay;
        let BackupSuccessCount = 0;
        if (instanceCreateTime) {
          if (start_time < moment.utc(instanceCreateTime.createdAt).startOf('day').toDate()) {
            currentDay = moment.utc(instanceCreateTime.createdAt).startOf('day').toDate();
          }
          _.assign(instance_record, {
            instanceCreateTime: instanceCreateTime.createdAt
          });
        } else {
          currentDay = new Date(end_time);
        }
        if (instanceDeleteTime && (end_time > instanceDeleteTime.createdAt)) {
          _.assign(instance_record, {
            instanceDeleteTime: instanceDeleteTime.createdAt
          });
          end_time = instanceDeleteTime.createdAt;
        }
        for (; currentDay < end_time; currentDay = moment(currentDay).add(1, 'days').toDate()) {
          let day_end = end_time < moment(currentDay).add(1, 'days').toDate() ? end_time : moment(currentDay).add(1, 'days').toDate();
          while (start_index < resultBackups.length && resultBackups[start_index].createdAt < currentDay) {
            start_index++;
          }
          //iterator to last entry on the day
          let end_index = start_index;
          while (
            end_index < resultBackups.length &&
            resultBackups[end_index].metric === 0 &&
            resultBackups[end_index].createdAt < day_end
          ) {
            end_index++;
          }
          BackupSuccessCount += (end_index - start_index);
          if (start_index === end_index) {
            noBackupDays.push(currentDay);
            if (
              (secondlastFailDay && lastFailDay) &&
              (secondlastFailDay.valueOf() === moment(lastFailDay).subtract(1, 'days').toDate().valueOf()) &&
              (lastFailDay.valueOf() === moment(currentDay).subtract(1, 'days').toDate().valueOf())
            ) {
              threeBackupFailureCount++;
            }
            secondlastFailDay = lastFailDay;
            lastFailDay = currentDay;
          }
        }
        const summary = {
          NoBackupDays: noBackupDays,
          BackupTriggerCount: triggeredBackups.length,
          BackupSuccessCount: BackupSuccessCount,
          BackupFailureCount: (resultBackups.length - BackupSuccessCount),
          FailedBackupList: resultBackups.slice(BackupSuccessCount),
          threeBackupFailureInRowCount: threeBackupFailureCount
        };
        _.assign(instance_record, summary);
        return instance_record;
      });
  }
  static getInstanceDeleteTime(instance_id) {
    const criteria = {
      type: CONST.JOB.SCHEDULED_BACKUP,
      'data.instance_id': instance_id,
      'response.delete_backup_status.instance_deleted': true
    };
    return Repository.findOne(CONST.DB_MODEL.JOB_RUN_DETAIL, criteria);
  }

  static getInstanceCreateTime(instance_id) {
    const criteria = {
      type: CONST.JOB.SCHEDULED_BACKUP,
      'data.instance_id': instance_id
    };
    return Repository.findOne(CONST.DB_MODEL.JOB, criteria);
  }


  static getInstanceIds(start_time, end_time) {
    function getInstanceIds(instanceList, offset, modelName, searchCriteria, paginateOpts) {
      if (offset < 0) {
        return Promise.resolve();
      }
      if (!paginateOpts) {
        paginateOpts = {
          records: config.external.mongodb.record_max_fetch_count,
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
          return getInstanceIds(instanceList, result.nextOffset, modelName, searchCriteria, paginateOpts);
        });
    }
    const criteria = {
      searchBy: {
        type: CONST.JOB.SCHEDULED_BACKUP
      },
      selectBy: {
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
    if (end_time) {
      _.assign(criteria.searchBy, {
        createdAt: {
          $lt: end_time
        }
      });
    }
    const paginateOpts = {
      records: config.external.mongodb.record_max_fetch_count,
      offset: 0
    };
    const result = [];
    return getInstanceIds(result, 0, CONST.DB_MODEL.JOB, criteria, paginateOpts)
      .then(() => result);
  }

  //start time and end_time are Date objects
  //Aggregated documents of all the triggered backup entries
  static getBackupTriggerRecord(instance_id, start_time, end_time) {
    const match = {
      eventName: 'create_backup',
      metric: 2,
      instanceId: instance_id,
      createdAt: {
        '$gte': start_time,
        '$lt': end_time
      }
    };
    const group = {
      _id: '$response.guid',
      createdAt: {
        $first: '$createdAt'
      }
    };
    const sort = {
      createdAt: 1
    };
    const operatorArray = [{
      $match: match
    }, {
      $group: group
    }, {
      $sort: sort
    }];
    return Repository.aggregate(CONST.DB_MODEL.EVENT_DETAIL, operatorArray);
  }
  //Aggregated documents of all the succeeded backup entries
  static getBackupResult(instance_id, start_time, end_time) {
    const match = {
      eventName: 'create_backup',
      instanceId: instance_id,
      metric: {
        '$ne': 2
      },
      createdAt: {
        '$gte': start_time,
        '$lt': end_time
      }
    };
    const group = {
      _id: '$request.backup_guid',
      metric: {
        $first: '$metric'
      },
      createdAt: {
        $first: '$createdAt'
      }
    };
    const sort = {
      metric: 1,
      createdAt: 1
    };
    const operatorArray = [{
      $match: match
    }, {
      $group: group
    }, {
      $sort: sort
    }];
    return Repository.aggregate(CONST.DB_MODEL.EVENT_DETAIL, operatorArray);
  }


}

module.exports = BackupReportManager;