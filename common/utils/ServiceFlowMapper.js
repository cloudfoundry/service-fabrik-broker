'use strict';

const _ = require('lodash');
const CONST = require('../constants');
const logger = require('../logger');

class ServiceFlowMapper {
  getServiceFlow(params) {
    let serviceFlow;
    const flowCheckers = ['_checkForMultiAz', '_checkForBluePrint'];
    for (let x = 0; x < flowCheckers.length; x++) {
      serviceFlow = this[flowCheckers[x]](params);
      if (serviceFlow !== undefined) {
        return serviceFlow;
      }
    }
    return serviceFlow;
  }

  _checkForMultiAz(params) {
    logger.debug(`Checking for multi-az-migrate - `);
    if (_.get(params, 'parameters.multi_az') !== undefined) {
      logger.info(`Multi-AZ_Upgrade Service Flow is to be executed`);
      return CONST.SERVICE_FLOW.TYPE.UPGRADE_MULTI_AZ;
    }
    return undefined;
  }

  _checkForBluePrint(params) {
    logger.debug(`Checking for blueprint multi-az-migrate - `);
    if (_.get(params, 'parameters.multi_az_bp') !== undefined) {
      logger.info(`Multi Az Migrate Service Flow for Blueprint is to be executed!`);
      return CONST.SERVICE_FLOW.TYPE.BLUEPRINT_SERVICEFLOW;
    }
    return undefined;
  }

}

module.exports = new ServiceFlowMapper();