'use strict';

const logger = require('../logger');
const BaseJob = require('./BaseJob');

class BasePollerJob extends BaseJob {
    static run() {
        throw new NotImplementedBySubclass('run');
    }
    
    static getRandomRepeatInterval() {
        throw new NotImplementedBySubclass('getRandomRepeatInterval');
    }
}

module.exports = BasePollerJob;