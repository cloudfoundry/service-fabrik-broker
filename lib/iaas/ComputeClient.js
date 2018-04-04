'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const AWS = require('aws-sdk');
const MsRestAzure = require('ms-rest-azure');
const ComputeManagementClient = require('azure-arm-compute');
const errors = require('../errors');

class ComputeClient {
  static createComputeClient(settings) {
    return Promise
      .try(() => {
        switch (settings.provider) {
        case 'amazon':
          {
            let ec2_config = {
              accessKeyId: settings.keyId,
              secretAccessKey: settings.key,
              region: settings.region
            };
            if ((typeof settings.max_retries === 'number') &&
              Number.isInteger(settings.max_retries) && settings.max_retries > 0) {
              ec2_config = _.assign(ec2_config, {
                maxRetries: settings.max_retries
              });
            }
            return new AWS.EC2(ec2_config);
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

  deleteSnapshot(settings) {
    throw errors.NotImplemented(`ComputeClient is not supported for ${settings.provider}`);
  }
}

module.exports = ComputeClient;