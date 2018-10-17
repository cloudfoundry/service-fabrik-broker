'use strict';

const _ = require('lodash');
const CONST = require('../constants');
const logger = require('../logger');

class WorkFlowMapper {
  getWorkFlow(params) {
    let workflow;
    const workFlowCheck = ['checkForMultiAz', 'checkForBluePrint'];
    for (let x = 0; x < workFlowCheck.length; x++) {
      workflow = this[workFlowCheck[x]](params);
      if (workflow !== undefined) {
        return workflow;
      }
    }
    return workflow;
  }
  checkForMultiAz(params) {
    logger.debug(`Checking for multi-az-migrate - `);
    if (_.get(params, 'parameters.multi_az') !== undefined) {
      logger.info(`Multi-AZ_Upgrade workflow is to be executed`);
      return CONST.WORKFLOW.TYPE.UPGRADE_MULTI_AZ;
    }
    return undefined;
  }

  checkForBluePrint(params) {
    logger.debug(`Checking for blueprint multi-az-migrate - `);
    if (_.get(params, 'parameters.multi_az_bp') !== undefined) {
      logger.info(`Multi Az Migrate for Blueprint is to be executed!`);
      return CONST.WORKFLOW.TYPE.BLUEPRINT_WORKFLOW;
    }
    return undefined;
  }
}

module.exports = new WorkFlowMapper();