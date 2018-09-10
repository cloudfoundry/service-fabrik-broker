'use strict';

const _ = require('lodash');
const config = require('../../../common/config');
const CONST = require('../../../common/constants');
const errors = require('../../../common/errors');
const logger = require('../../../common/logger');
const jwt = require('../jwt');
const utils = require('../../../common/utils');
const cf = require('../../../data-access-layer/cf');
const DirectorManager = require('./DirectorManager');
const cloudController = cf.cloudController;
const Conflict = errors.Conflict;
const DeploymentAlreadyLocked = errors.DeploymentAlreadyLocked;
const DeploymentAttemptRejected = errors.DeploymentAttemptRejected;

function AsyncServiceInstanceOperationInProgress(err) {
  const response = _.get(err, 'error', {});
  return response.code === 60016 || response.error_code === 'CF-AsyncServiceInstanceOperationInProgress';
}

function DeploymentLocked(err) {
  const response = _.get(err, 'error', {});
  const description = _.get(response, 'description', '');
  return description.indexOf(CONST.OPERATION_TYPE.LOCK) > 0 && response.error_code === 'CF-ServiceBrokerRequestRejected';
}

function DeploymentStaggered(err) {
  const response = _.get(err, 'error', {});
  const description = _.get(response, 'description', '');
  return description.indexOf(CONST.FABRIK_OPERATION_STAGGERED) > 0 && description.indexOf(CONST.FABRIK_OPERATION_COUNT_EXCEEDED) > 0 && response.error_code === 'CF-ServiceBrokerRequestRejected';
}

class ServiceFabrikOperation {
  constructor(name, opts) {
    this.name = name;
    this.guid = undefined;
    opts = opts || {};
    this.bearer = opts.bearer;
    this.username = opts.username;
    this.useremail = opts.useremail;
    this.arguments = opts.arguments || {};
    this.isOperationSync = opts.isOperationSync ? true : false;
    this.runImmediately = opts.runImmediately;
    if (opts.instance_id) {
      this.instanceId = opts.instance_id;
    } else if (opts.deployment) {
      this.instanceId = _.nth(DirectorManager.parseDeploymentName(opts.deployment), 2);
    }
  }

  toJSON() {
    return _.pick(this, 'name', 'guid', 'username', 'useremail', 'arguments');
  }

  getResult() {
    return _.pick(this, 'name', 'guid');
  }

  getToken() {
    return utils
      .uuidV4()
      .then(guid => _.set(this, 'guid', guid))
      .then(() => jwt.sign(this.toJSON(), config.password));
  }

  updateServiceInstance(token) {
    const options = {
      parameters: {
        'service-fabrik-operation': token
      }
    };
    if (this.runImmediately) {
      options.parameters._runImmediately = this.runImmediately;
    }
    options.isOperationSync = this.isOperationSync;
    if (this.bearer) {
      options.auth = {
        bearer: this.bearer
      };
    }
    return cloudController.updateServiceInstance(this.instanceId, options);
  }

  invoke() {
    return this
      .getToken()
      .then(token => this.updateServiceInstance(token))
      .then(() => this.getResult())
      .catch(AsyncServiceInstanceOperationInProgress, err => {
        const message = _.get(err.error, 'description', 'Async service instance operation in progress');
        throw new Conflict(message);
      })
      .catch(DeploymentStaggered, err => {
        logger.info('Deployment operation not proceeding due to rate limit exceeded', err.message);
        throw new DeploymentAttemptRejected(this.deployment || this.instanceId);
      })
      .catch(DeploymentLocked, err => {
        // Sample error description is 
        // Service broker error: Service Instance abcdefgh-abcd-abcd-abcd-abcdefghijkl __Locked__ at Mon Sep 10 2018 11:17:01 GMT+0000 (UTC) for backup
        const description = _.get(err, 'error.description', '');
        const lookupString = 'error: ';
        const startIdx = description.indexOf(lookupString);
        let lockMsg;
        if (startIdx !== -1) {
          lockMsg = description.substring(startIdx + lookupString.length);
        }
        logger.info(`Lock message : ${lockMsg}`);
        throw new DeploymentAlreadyLocked(this.instanceId, undefined, lockMsg);
      });
  }

  handle(req, res) {
    if (_.isObject(req.user)) {
      this.username = req.user.name;
      this.useremail = req.user.email || '';
    }
    return this
      .invoke()
      .then(body => res
        .status(202)
        .send(body)
      );
  }
}

module.exports = ServiceFabrikOperation;