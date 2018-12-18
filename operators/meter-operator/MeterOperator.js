'use strict';

const CONST = require('../../common/constants');
const BaseOperator = require('../BaseOperator');

class MeterOperator extends BaseOperator {
  init() {
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.INSTANCE, CONST.APISERVER.RESOURCE_TYPES.SFEVENT);
  }
}

module.exports = MeterOperator;