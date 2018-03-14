const _ = require('lodash');
const Promise = require('bluebird');
const utils = require('../utils');
const Repository = require('../db').Repository;
const logger = require('../logger');
const CONST = require('../constants');
const errors = require('../errors');
const config = require('../config');

class MaintenanceManager {

  startMaintenace(maintenanceInfo, user) {
    return Promise.try(() => {
      if (maintenanceInfo.progress === undefined) {
        maintenanceInfo.progress = [`Service-fabrik maintenace mode is being initiated ${new Date()}`];
      } else {
        maintenanceInfo.progress = [`${maintenanceInfo.progress} at ${new Date()}`];
      }
      if (maintenanceInfo.fromVersion === undefined) {
        maintenanceInfo.fromVersion = `NA_${new Date().getTime()}`;
      }
      if (maintenanceInfo.toVersion === undefined) {
        maintenanceInfo.toVersion = `NA_${new Date().getTime()}`;
      }
      maintenanceInfo.state = CONST.OPERATION.IN_PROGRESS;
      maintenanceInfo.completedAt = null;
      logger.info('Going to save maintenance detail:', maintenanceInfo);
      return Repository.save(CONST.DB_MODEL.MAINTENANCE_DETAIL, maintenanceInfo, user);
    });
  }

  updateMaintenace(progressInfo, state, user) {
    const criteria = {
      state: `${CONST.OPERATION.IN_PROGRESS}`
    };
    logger.info('searching by criteria: ', criteria);
    return Repository
      .findOne(CONST.DB_MODEL.MAINTENANCE_DETAIL, criteria)
      .then((model) => {
        if (_.isEmpty(model)) {
          throw new errors.BadRequest(`System not in maitenance mode`);
        }
        if (progressInfo === undefined || _.isEmpty(progressInfo.trim())) {
          throw new errors.BadRequest(`Progressinfo is mandatory`);
        } else {
          model.progress.push(`${progressInfo} at ${new Date()}`);
        }
        if (state !== undefined) {
          if (_.chain(CONST.OPERATION).valuesIn().indexOf(state).value() === -1) {
            throw new errors.BadRequest(`Maintenance state can be only one of these values : ${_.valuesIn(CONST.OPERATION)}`);
          }
          if (utils.isServiceFabrikOperationFinished(state)) {
            model.completedAt = new Date();
          }
          model.state = state;
        }
        logger.info('maintenance info being udpated :', _.pick(model, ['progress', 'state', 'completedAt', 'reason', 'toVersion', 'fromVersion', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']));
        return Repository.save(CONST.DB_MODEL.MAINTENANCE_DETAIL, model, user);
      });
  }

  getMaintenaceInfo() {
    const criteria = {
      state: CONST.OPERATION.IN_PROGRESS
    };
    return Repository
      .findOne(CONST.DB_MODEL.MAINTENANCE_DETAIL, criteria);
  }

  getLastMaintenaceState() {
    const START_OFFSET = 0;
    const NUMBER_OF_RECORDS = 1;
    return this
      .getMaintenaceHistory(START_OFFSET, NUMBER_OF_RECORDS)
      .then(maintenanceDetails => {
        if (_.get(maintenanceDetails, 'totalRecordCount', 0) === 0) {
          logger.info('Last maintenance details is empty');
          return null;
        }
        return maintenanceDetails.list[0];
      });
  }

  getMaintenaceHistory(offset, records, sortBy, sortOrder) {
    logger.info(`fetching maint history with params offset:${offset} - records : ${records} - sortBy : ${sortBy} - sortOrder : ${sortOrder}`);
    let sortOn;
    sortOrder = sortOrder === undefined ? 'desc' : sortOrder;
    if (_.isArray(sortBy)) {
      sortOrder = _.isArray(sortOrder) ? sortOrder : [sortOrder];
      sortOn = _.map(sortBy, (value, idx) => [value, sortOrder[sortOrder.length - 1 ? idx : (sortOrder.length - 1)]]);
    } else {
      sortOn = sortBy === undefined ? [
        ['createdAt', 'desc']
      ] : [
        [sortBy, sortOrder]
      ];
    }
    //sortOn - must be an array of arrays
    logger.debug('sort on criteria: ', sortOn);
    const criteria = {
      sortBy: sortOn
    };
    if (offset === undefined || offset < 0) {
      offset = 0;
    }
    if (records === undefined || records < 0 || records > config.mongodb.record_max_fetch_count) {
      records = config.mongodb.record_max_fetch_count;
    }
    return Repository
      .search(CONST.DB_MODEL.MAINTENANCE_DETAIL, criteria, {
        records: records,
        offset: offset
      });
  }
}
module.exports = MaintenanceManager;