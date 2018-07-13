'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const AWS = require('aws-sdk');
const MsRestAzure = require('ms-rest-azure');
const ComputeManagementClient = require('azure-arm-compute');
const CONST = require('../../common/constants');
const errors = require('../../common/errors');
const NotImplemented = errors.NotImplemented;

class ComputeClient {
  static createComputeClient(settings) {
    return Promise
      .try(() => {
        switch (settings.provider) {
        case 'amazon':
          {
            let ec2Config = {
              accessKeyId: settings.keyId,
              secretAccessKey: settings.key,
              region: settings.region,
              maxRetries: CONST.SDK_CLIENT.AWS.MAX_RETRIES
            };
            if (Number.isInteger(settings.max_retries) &&
              settings.max_retries > 0) {
              ec2Config = _.assign(ec2Config, {
                maxRetries: settings.max_retries
              });
            }
            return new AWS.EC2(ec2Config);
          }
        case 'azure':
          {
            const credentials = new MsRestAzure.ApplicationTokenCredentials(
              settings.client_id,
              settings.tenant_id,
              settings.client_secret);
            return new ComputeManagementClient(
              credentials, settings.subscription_id);
          }
        default:
          return new BaseComputeClient(settings);
        }
      });
  }
}

class BaseComputeClient {

  constructor(settings) {
    this.settings = settings;
  }

  deleteSnapshot(snapshotId) {
    /* jshint unused:false */
    throw new NotImplemented(`ComputeClient is not supported for ${this.settings.provider}.`);
  }
}

module.exports = ComputeClient;