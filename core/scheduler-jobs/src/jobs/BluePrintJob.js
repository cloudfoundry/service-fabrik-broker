'use strict';

const logger = require('@sf/logger');
const BaseJob = require('./BaseJob');

class BluePrintJob extends BaseJob {

  static run(job, done) {
    logger.info(`Starting blueprint Job with Job atttrs: ${JSON.stringify(job.attrs.data)} @ ${new Date()}`);
    this.runSucceeded({
      status: 'success'
    }, job, done);
  }
}

module.exports = BluePrintJob;
