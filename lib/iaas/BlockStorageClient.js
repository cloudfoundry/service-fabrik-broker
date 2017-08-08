'use strict';

const Promise = require('bluebird');
const AWS = require('aws-sdk');
const errors = require('../errors');

class BlockStorageClient {
  static createBlockStorageClient(settings) {
    return Promise
      .try(() => {
        switch (settings.provider) {
        case 'amazon':
          return new AWS.EC2({
            accessKeyId: settings.keyId,
            secretAccessKey: settings.key,
            region: settings.region
          });
        default:
          return new BaseBlockStorageClient(settings);
        }
      });
  }
}

class BaseBlockStorageClient {

  constructor(settings) {
    this.settings = settings;
  }

  deleteSnapshot(settings) {
    throw errors.NotImplemented(`BlockStorageClient is not supported for ${settings.provider}`);
  }
}


module.exports = BlockStorageClient;