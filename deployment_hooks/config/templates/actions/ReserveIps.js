'use strict';

const Promise = require('bluebird');
const BaseAction = require('./BaseAction');

class ReserveIps extends BaseAction {
  /* jshint unused:false */
  static executePreCreate(context) {
    return Promise.try(() => {
      return ['10.244.11.247'];
    });
  }
}

module.exports = ReserveIps;