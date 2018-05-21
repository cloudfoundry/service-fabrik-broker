'use strict';

const BaseJob = require('./BaseJob');
const errors = require('../errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class BasePollerJob extends BaseJob {
  static run() {
    throw new NotImplementedBySubclass('run');
  }

  static getRandomRepeatInterval() {
    throw new NotImplementedBySubclass('getRandomRepeatInterval');
  }
}

module.exports = BasePollerJob;