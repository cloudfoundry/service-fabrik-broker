'use strict';

const Promise = require('bluebird');
const logger = require('../../../logger');
const BaseAction = require('./BaseAction');

class ReserveIps extends BaseAction {
  static executePreCreate(instanceId, deploymentName, reqParams, sfOperationArgs) {
    return Promise.try(() => {
      logger.info(`Executing ReserveIPs.preCreate for ${instanceId} - ${deploymentName} with request params - `, reqParams, ' sf operation params - ', sfOperationArgs);
      return ['10.244.11.247'];
    });
  }
}

module.exports = ReserveIps;