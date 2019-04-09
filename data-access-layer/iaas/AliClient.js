'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const Storage = require('ali-oss');
const logger = require('../../common/logger');
const BaseCloudClient = require('./BaseCloudClient');
const errors = require('../../common/errors');
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;
const Forbidden = errors.Forbidden;
const UnprocessableEntity = errors.UnprocessableEntity;

class AliClient extends BaseCloudClient {
  constructor(settings) {
    super(settings);
    this.storage = this.constructor.createStorageClient(_
      .chain(this.settings)
      .omit('name')
      .set('provider', this.provider)
      .value()
    );
  }

  getContainer(container) {
    if (arguments.length < 1) {
      container = this.containerName;
    }
    logger.debug('Looking for container ' + container);
    return Promise.try(() => {
      return this.storage.listBuckets({
        prefix: container
      })
        .then(buckets => {
          if (buckets.buckets === null) {
            logger.error('Bucket ' + container + ' does not exists');
            throw new NotFound(`Bucket ${container} does not exist`);
          } else if (buckets.buckets.length == 1) {
            logger.info('Bucket ' + container + ' exists');
            return buckets.buckets;
          } else {
            logger.error('More than 1 Buckets with prefix ' + container + ' exists');
            throw new Error(`More than 1 Buckets with prefix ${container} exists`);
          }
        });
    });
  }

  list(container, options) {
    if (arguments.length < 2) {
      options = container;
      container = this.containerName;
    }
    return this.storage
      .useBucket(container)
      .list(options)
      .then(listOfFiles => {
        let list = listOfFiles.objects;
        let isTruncated = listOfFiles.isTruncated;
        let marker = listOfFiles.nextMarker;
        const files = [];
        _.each(list, file => files.push(_
          .chain(file)
          .pick('name', 'lastModified')
          .set('isTruncated', isTruncated)
          .set('marker', marker)
          .value()
        ));
        return files;
      });
  }

  remove(container, file) {
    if (arguments.length < 2) {
      file = container;
      container = this.containerName;
    }

    logger.info('Deleting file ' + file + ' from container ' + container);
    return this.storage
      .useBucket(container)
      .delete(file)
      .then(() => {
        logger.info('Deleted file ' + file + ' from container ' + container);
      })
      .catchThrow(BaseCloudClient.providerErrorTypes.Unauthorized,
        new Unauthorized(`Authorization at ali cloud storage provider failed while deleting blob ${file} in container ${container}`))
      .catchThrow(BaseCloudClient.providerErrorTypes.Forbidden,
        new Forbidden(`Authentication at ali cloud storage provider failed while deleting blob ${file} in container ${container}`))
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound,
        new NotFound(`Object '${file}' not found while deleting in container ${container}`));
  }

  download(options) {
    return Promise.try(() => {
      return this.storage
        .useBucket(options.container)
        .get(options.remote)
        .then(result => {
          return result.content;
        });
    })
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound, new NotFound(`Object '${options.remote}' not found`));
  }

  upload(options, buffer) {
    return Promise.try(() => {
      return this.storage
        .useBucket(options.container)
        .put(options.remote, buffer)
        .then(() => JSON.parse(buffer));
    });
  }

  uploadJson(container, file, data) {
    if (arguments.length < 3) {
      data = file;
      file = container;
      container = this.containerName;
    }

    logger.info('Uploading file ' + file + ' to container ' + container);
    return this.upload({
      container: container,
      remote: file
    }, new Buffer(JSON.stringify(data, null, 2), 'utf8'));
  }

  downloadJson(container, file) {
    if (arguments.length < 2) {
      file = container;
      container = this.containerName;
    }
    logger.info('Downloading file ' + file + ' from container ' + container);
    return this.download({
      container: container,
      remote: file
    })
      .then(data => JSON.parse(data))
      .catchThrow(SyntaxError, new UnprocessableEntity(`Object '${file}' data unprocessable`));
  }

  createDiskFromSnapshot(snapshotId, zone, opts = {}) {}

  getDiskMetadata(diskCid, zone) {}

  deleteSnapshot() {}

  getRandomDiskId() {}

  static createComputeClient() {}

  static createStorageClient(options) {
    return Storage({
      region: options.region,
      accessKeyId: options.keyId,
      accessKeySecret: options.key,
      endpoint: options.endpoint
    });
  }
}

module.exports = AliClient;
