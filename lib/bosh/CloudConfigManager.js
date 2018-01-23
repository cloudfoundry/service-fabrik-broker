'use strict';

const _ = require('lodash');
const assert = require('assert');
const Promise = require('bluebird');
const yaml = require('js-yaml');
const BoshDirectorClient = require('./BoshDirectorClient');
const utils = require('../utils');
const HttpClient = utils.HttpClient;
const errors = require('../errors');
const logger = require('../logger');
const CONST = require('../constants');
const config = require('../config');

class CloudConfigManager extends HttpClient {
  constructor() {
    super();
    this.LOCKS = {};
    this.cloudConfigName = BoshDirectorClient.getInfrastructure().segmentation.network_name || 'default';
  }

  getConfigByName(name) {
    return _.head(_.filter(config.directors, (director) => director.name === name));
  }

  makeRequestWithConfig(requestDetails, expectedStatusCode, directorConfig) {
    requestDetails.baseUrl = directorConfig.url;
    requestDetails.auth = {
      user: directorConfig.username,
      pass: directorConfig.password
    };
    requestDetails.rejectUnauthorized = !directorConfig.skip_ssl_validation;
    return this.request(requestDetails, expectedStatusCode);
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
              this.getCloudConfig(directorName, this.cloudConfigName)
                .then(cloudConfig => updateHandler(cloudConfig))
                .tap(updateHandlerRes => updateHandlerResponse = updateHandlerRes)
                .then((modifiedCloudConfig) => this._updateCloudConfig(guid, modifiedCloudConfig[0], directorName))
                .tap(() => this._processOutStandingRequest(cloudConfigOps))
                .then(() => resolve(updateHandlerResponse))
                .catch(err => {
                  this._unlock(cloudConfigOps);
                  reject(err);
                });
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

  _unlock(cloudConfigOps) {
    cloudConfigOps.REQUEST_IN_PROGRESS = false;
    cloudConfigOps.LOCKED = false;
    delete cloudConfigOps.LOCK;
  }

  _processOutStandingRequest(cloudConfigOps) {
    logger.info(`Processing outstanding requests.. Queued Count: ${cloudConfigOps.QUEUED_REQUESTS.length}`);
    this._unlock(cloudConfigOps);
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
        const payLoad = {
          type: CONST.BOSH_CONFIG_TYPE.CLOUD,
          name: this.cloudConfigName,
          content: _.isObject(cloudConfig) ? yaml.safeDump(cloudConfig) : cloudConfig
        };
        return this.makeRequestWithConfig({
            method: 'POST',
            url: '/configs',
            json: true,
            qs: {
              redact: 'false'
            },
            body: payLoad
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

  getCloudConfig(directorName, name) {
    name = name || this.cloudConfigName;
    const query = {
      type: CONST.BOSH_CONFIG_TYPE.CLOUD,
      name: name,
      latest: true
    };
    return this.makeRequestWithConfig({
        method: 'GET',
        url: '/configs',
        qs: query
      }, 200, directorName !== undefined ? this.getConfigByName(directorName) : _.sample(this.activePrimary))
      .then(res => {
        const cloudConfigs = JSON.parse(res.body);
        if (cloudConfigs.length === 0) {
          return undefined;
        }
        const cloudConfig = yaml.safeLoad(cloudConfigs[0].content);
        return cloudConfig;
      });
  }
}

module.exports = new CloudConfigManager();