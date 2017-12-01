'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const moment = require('moment-timezone');
const Repository = require('../db').Repository;
const CONST = require('../constants');
const config = require('../config');
class BackupReportManager {
  createInstanceRecord(instance_id, start_time, end_time) {
    return Promise
      .all([
        this.getBackupTriggerRecord(start_time, end_time),
        this.getBackupSuccessRecord(start_time, end_time),
        this.getBackupfailureRecord(start_time, end_time)
      ])
      .spread((triggeredBackups, succeededBackups, failedBackups) => {
        const instance_record = {};
        const noBackupDays = [];
        const succeededBackupList = succeededBackups.toArray();
        var start_index = 0;
        var threeBackupFailureCount = 0;
        var currentDay = new Date(start_time);
        var lastFailDay = new Date(currentDay);
        var secondlastFailDay = new Date(currentDay);
        for (; currentDay < end_time; currentDay = moment(currentDay).add(1, 'days').toDate()) {
          const day_end = end_time < moment(currentDay).add(1, 'days').toDate() ? end_time : moment(currentDay).add(1, 'days').toDate();
          while (start_index < succeededBackupList.length && succeededBackupList[start_index].createdAt < currentDay) {
            start_index++;
          }
          let end_index = start_index;
          while (end_index < succeededBackupList.length && succeededBackupList[end_index].createdAt < day_end && succeededBackupList[end_index].createdAt >= currentDay) {
            end_index++;
          }
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
          BackupTriggerCount: triggeredBackups.toArray().length,
          BackupSuccessCount: succeededBackupList.length,
          FailedBackupList: failedBackups.toArray(),
          threeBackupFailureInRowCount: threeBackupFailureCount
        };
        _.assign(instance_record, summary);
        return instance_record;
      });
  }



  getInstanceIds(start_time, end_time) {
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
        type: CONST.JOB.SCHEDULED_BACKUP,
        createdAt: {
          $lt: end_time
        }
      },
      selectBy: {
        'data.instance_id': 1,
        'data.plan_id': 1,
        'data.space_guid': 1,
        'data.space_name': 1,
        'data.label': 1,
        'data.instance_name': 1,
        'data.organization_name': 1,
        'data.organization_guid': 1
      }
    };
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
  getBackupSuccessRecord(instance_id, start_time, end_time) {
    const match = {
      eventName: 'create_backup',
      instanceId: instance_id,
      metric: {
        '$ne' : 2
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
  //Aggregated documents of all the failed backup entries
  getBackupfailureRecord(instance_id, start_time, end_time) {
    const match = {
      eventName: 'create_backup',
      instanceId: instance_id,
      metric: 1,
      createdAt: {
        '$gte': start_time,
        '$lt': end_time
      }
    };
    const group = {
      _id: '$request.backup_guid',
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


}

module.exports = BackupReportManager;
