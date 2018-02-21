'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const bosh = require('../../../bosh');
const logger = require('../../../logger');
const CONST = require('../../../constants');
const config = require('../../../config');
const errors = require('../../../errors');
const BoshDirectorClient = require('../../../bosh/BoshDirectorClient');
const Repository = require('../../../db').Repository;
const cloudConfigManager = bosh.cloudConfigManager;
const BaseAction = require('./BaseAction');

class ReserveIps extends BaseAction {
  /* jshint unused:false */
  static executePreCreate(instanceId, deploymentName, reqParams, sfOperationArgs) {
    return Promise.try(() => {
      logger.info(`Executing ReserveIPs.preCreate for ${instanceId} - ${deploymentName} with request params - `, reqParams);
      //TODO: This is a dummy implementation. Actual implementation present in branch feature/dynamic_ip
      return ['10.244.11.247'];
    });
  }
  static executePostCreate() {}
  static executePreDelete() {}
  static executePostDelete() {}
}

module.exports = ReserveIps;