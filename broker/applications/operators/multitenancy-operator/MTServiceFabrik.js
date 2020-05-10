'use strict';

const { CONST } = require('@sf/common-utils');
const logger = require('@sf/logger');
const MultitenancyService = require('./MultitenancyService');
const MultitenancyBindService = require('./MultitenancyBindService');

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
