'use strict';

const Promise = require('bluebird');
const logger = require('../../../logger');
const BaseAction = require('./BaseAction');

class ReserveIps extends BaseAction {
  static executePreCreate(context) {
    return Promise.try(() => {
      logger.info('Executing ReserveIPs.preCreate with parameters: ', context);
      return ['10.244.11.247'];
    });
  }
}

module.exports = ReserveIps;