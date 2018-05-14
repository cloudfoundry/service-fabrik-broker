'use strict';

const _ = require('lodash');
const BasePollerJob = require('./BasePollerJob');

class BnRStatusPollerJob extends BasePollerJob {
  constructor() {
    super();
  }

  static run(job, done) {
    job.__started_At = new Date();
    const options = job.attrs.data;
    logger.info(`-> Starting BnRStatusPollerJob -  name: ${job.attrs.data[CONST.JOB_NAME_ATTRIB]}
          - operation: ${options.operation} - with options: ${JSON.stringify(options)} `);
    if (!_.get(options, 'instance_guid') || !_.get(options, 'type') ||
      !_.get(options, 'operation') || !_.get(options, 'backup_guid')) {
      const msg = `BnR status poller cannot be initiated as the required mandatory params 
        (instance_guid | type | operation | backup_guid) is empty : ${JSON.stringify(options)}`;
      logger.error(msg);
      return this.runFailed(new errors.BadRequest(msg), {}, job, done);
    }
    else if (_.get(options, 'operation') !== 'backup' && _.get(options, 'operation') !== 'restore') {
      const msg = `Operation polling not supported for operation - ${options.operation}`;
      logger.error(msg);
      const err = {
        statusCode: `ERR_${options.operation.toUpperCase()}_NOT_SUPPORTED`,
        statusMessage: msg
      };
      return this.runFailed(err, {}, job, done);
    } else {
      //modify the first argument here based on implementation of the function
      return this.checkOperationCompletionStatus(options.token, job)
        .then(operationStatusResponse => this.runSucceeded(operationStatusResponse, job, done))
        .catch(err => {
          logger.error(`Error occurred while running operation ${options.operation} status poller for instance ${_.get(options, 'instance_guid')}.`, err);
          return this.runFailed(err, {}, job, done);
        });
    }
  }

  static checkOperationCompletionStatus(token, job) {

    const operationStartedAt = moment(new Date(job.attrs.data.started_at));
    const instanceGuid = job.attrs.data.instance_guid;
    const operationName = job.attrs.data.operation;
    const backupGuid = job.attrs.data.backup_guid;
    const planId = job.attrs.data.plan_id;
    //const boshDirectorName = job.attrs.data.bosh_director;

    return Promise.try(() => {
      if (operationName === 'backup') {
        return this
          .getFabrikClient()
          .getInstanceBackupStatus(options, token);
      } else {
        throw new errors.BadRequest(`Operation ${operationName} not supported by BnR status poller.`);
      }
    })

  }
}

module.exports = BnRStatusPollerJob;