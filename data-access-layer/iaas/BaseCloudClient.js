'use strict';

const _ = require('lodash');
const uuid = require('uuid');
const errors = require('../../common/errors');
const CONST = require('../../common/constants');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

const CloudProviderError = {
  NotFound: err => {
    return err.statusCode === CONST.HTTP_STATUS_CODE.NOT_FOUND || err.failCode === 'Item not found' ||
      err.code === CONST.HTTP_STATUS_CODE.NOT_FOUND || err.code === 'NotFound' ||
      err.status == CONST.HTTP_STATUS_CODE.NOT_FOUND ||
      String(err.code).includes('NotFound') || String(err.statusCode).includes('NotFound');
  },
  Unauthorized: err => {
    return err.statusCode === CONST.HTTP_STATUS_CODE.UNAUTHORIZED || err.status === CONST.HTTP_STATUS_CODE.UNAUTHORIZED ||
      err.failCode === 'Unauthorized';
  },
  Forbidden: err => {
    return err.statusCode === CONST.HTTP_STATUS_CODE.FORBIDDEN || err.status === CONST.HTTP_STATUS_CODE.FORBIDDEN ||
      err.code === CONST.HTTP_STATUS_CODE.FORBIDDEN;
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

  createDiskFromSnapshot(snapshotId, zones, options) {
    throw new NotImplementedBySubclass(`createDiskFromSnapshot - ${snapshotId}, ${zones}, ${options}`);
  }

  getDiskMetadata(diskCid, zone) {
    throw new NotImplementedBySubclass(`getDiskMetadata: ${diskCid}, ${zone}`);
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

  getRandomDiskId() {
    return `sf-disk-${uuid.v4()}`;
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
