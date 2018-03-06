'use strict';

const _ = require('lodash');
const errors = require('../errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

const CloudProviderError = {
  NotFound: err => {
    return err.statusCode === 404 || err.failCode === 'Item not found' || err.code === 404 || err.code === 'NotFound';
  },
  Unauthorized: err => {
    return err.statusCode === 401 || err.failCode === 'Unauthorized';
  },
  Forbidden: err => {
    return err.statusCode === 403 || err.code === 403;
  }
};

class BaseCloudClient {
  constructor(settings) {
    this.settings = settings;
  }

  get provider() {
    switch (this.settings.name) {
    case 'aws':
      return 'amazon';
    case 'os':
      return 'openstack';
    default:
      return this.settings.name;
    }
  }

  get containerName() {
    return this.settings.container || this.settings.containerName;
  }

  get containerPrefix() {
    return _.nth(/^(.+)-broker$/.exec(this.containerName), 1);
  }

  getContainer() {
    throw new NotImplementedBySubclass('getContainer');
  }

  list() {
    throw new NotImplementedBySubclass('list');
  }

  remove() {
    throw new NotImplementedBySubclass('remove');
  }

  download() {
    throw new NotImplementedBySubclass('download');
  }

  upload() {
    throw new NotImplementedBySubclass('upload');
  }

  uploadJson() {
    throw new NotImplementedBySubclass('uploadJson');
  }

  downloadJson() {
    throw new NotImplementedBySubclass('downloadJson');
  }

  deleteSnapshot() {
    throw new NotImplementedBySubclass('deleteSnapshot');
  }

  static createStorageClient() {
    throw new NotImplementedBySubclass('createStorageClient');
  }

  static createComputeClient() {
    throw new NotImplementedBySubclass('createComputeClient');
  }

  static get providerErrorTypes() {
    return CloudProviderError;
  }
}

module.exports = BaseCloudClient;