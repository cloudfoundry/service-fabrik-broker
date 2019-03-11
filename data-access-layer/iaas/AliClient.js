'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const Storage = require('ali-oss');
const logger = require('../../common/logger');
const BaseCloudClient = require('./BaseCloudClient');
const errors = require('../../common/errors');
const NotFound = errors.NotFound;

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
      .catch(err => {
        logger.error(err.message);
      });
  }

  download(options) {
    return Promise.try(() => {
      return this.storage
        .useBucket(options.container)
        .get(options.remote)
        .then(result => {
          return result.content;
        })
        .catch(err => {
          console.error(err);
        });
    });
  }

  upload(options, buffer) {
    return Promise.try(() => {
      return this.storage
        .useBucket(options.container)
        .put(options.remote, buffer)
        .then(() => JSON.parse(buffer))
        .catch(err => {
          logger.error(err);
        });
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
      .then(data => JSON.parse(data));
  }

  createDiskFromSnapshot(snapshotId, zone, opts = {}) { }

  getDiskMetadata(diskCid, zone) { }

  deleteSnapshot() { }

  getRandomDiskId() { }

  static createComputeClient() { }

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
