'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const yaml = require('js-yaml');
const BoshDirectorClient = require('./BoshDirectorClient');
const utils = require('../utils');
const errors = require('../errors');
const logger = require('../logger');

class CloudConfigManager extends BoshDirectorClient {
  constructor() {
    super();
    this.LOCKS = {};
  }

  fetchCloudConfigAndUpdate(updateHandler, directorName) {
    return Promise.try(() => {
      assert.ok(directorName, 'director name required for this operation');
      assert.ok(typeof updateHandler === 'function', 'UpdateHandler must be a function which must return a promise & promise must resolve into modified cloud config');
      return new Promise((resolve, reject) => {
        const cloudConfigOps = this.LOCKS[directorName] || {
          directorName: directorName,
          QUEUED_REQUESTS: []
        };
        this.LOCKS[directorName] = cloudConfigOps;
        if (cloudConfigOps.LOCKED) {
          logger.info(`Cloud config currently locked , queing current update request`, cloudConfigOps);
          this._enqueRequest(cloudConfigOps, updateHandler, resolve, reject);
        } else {
          cloudConfigOps.LOCKED = true;
          cloudConfigOps.LOCK_CREATED_AT = new Date();
          let updateHandlerResponse;
          utils
            .uuidV4()
            .then(guid => {
              cloudConfigOps.LOCK = guid;
              this.getCloudConfig(directorName)
                .then(cloudConfig => updateHandler(cloudConfig))
                .tap(updateHandlerRes => updateHandlerResponse = updateHandlerRes[1])
                .then((modifiedCloudConfig) => this._updateCloudConfig(guid, modifiedCloudConfig[0], directorName))
                .tap(() => this._processOutStandingRequest(cloudConfigOps))
                .then(() => resolve(updateHandlerResponse))
                .catch(err => reject(err));
            });
        }
      });
    });
  }

  _enqueRequest(cloudConfigOps, updateHandler, resolve, reject) {
    cloudConfigOps.QUEUED_REQUESTS.push({
      directorName: cloudConfigOps.directorName,
      updateHandler: updateHandler,
      resolve: resolve,
      reject: reject
    });
  }

  _dequeRequest(cloudConfigOps) {
    return cloudConfigOps.QUEUED_REQUESTS.length === 0 ? null : cloudConfigOps.QUEUED_REQUESTS.splice(0, 1)[0];
  }

  _isRequestQueueNonEmpty(directorName) {
    return this.LOCKS[directorName].QUEUED_REQUESTS && this.LOCKS[directorName].QUEUED_REQUESTS.length > 0;
  }

  _processOutStandingRequest(cloudConfigOps) {
    cloudConfigOps.REQUEST_IN_PROGRESS = false;
    cloudConfigOps.LOCKED = false;
    delete cloudConfigOps.LOCK;
    logger.info(`Processing outstanding requests.. Queued Count: ${cloudConfigOps.QUEUED_REQUESTS.length}`);
    const request = this._dequeRequest(cloudConfigOps);
    if (request !== null) {
      logger.info(`Processing queued up request for director - ${request.directorName}`);
      this
        .fetchCloudConfigAndUpdate(request.updateHandler, request.directorName)
        .then(res => request.resolve(res))
        .catch(err => request.reject(err));
    }
  }

  _updateCloudConfig(lockGuid, cloudConfig, directorName) {
    return Promise.try(() => {
      const cloudConfigOps = this.LOCKS[directorName] || {};
      if (cloudConfigOps.LOCKED && cloudConfigOps.LOCK === lockGuid) {
        cloudConfigOps.UPDATE_IN_PROGRESS = true;
        logger.info('Updating Cloud config with..', yaml.safeDump(cloudConfig));
        return this.makeRequestWithConfig({
            method: 'POST',
            url: '/cloud_configs',
            headers: {
              'Content-Type': 'text/yaml'
            },
            qs: {
              redact: 'false'
            },
            body: _.isObject(cloudConfig) ? yaml.safeDump(cloudConfig) : cloudConfig
          }, 201, this.getConfigByName(directorName))
          .then(res => res.body);
      } else {
        logger.error('Lock not acquired, cant update cloud config:', cloudConfigOps, this.LOCKS);
        const message = cloudConfigOps.LOCKED ? `Lock Guid input ${lockGuid} does not match with the lock guid ${cloudConfigOps.LOCK}` :
          `Trying to update without acquiring the lock is not permitted`;
        throw new errors.Forbidden(message);
      }
    });
  }
}

module.exports = new CloudConfigManager();