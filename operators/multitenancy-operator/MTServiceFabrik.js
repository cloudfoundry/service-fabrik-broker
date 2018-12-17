'use strict';

const CONST = require('../../common/constants');
const MultitenancyService = require('./MultitenancyService');
const MultitenancyBindService = require('./MultitenancyBindService');
const logger = require('../../common/logger');

class MTServiceFabrik {
  static getService(service) {
    switch (service) {
    case CONST.MULTITENANCY_SERVICE_TYPE.MULTITENANCYSERVICE:
      return MultitenancyService;
    case CONST.MULTITENANCY_SERVICE_TYPE.MULTITENANCYBINDSERVICE:
      return MultitenancyBindService;
    default:
      logger.error('Service does not exist:', service);
      break;
    }
  }
}

module.exports = MTServiceFabrik;