'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const Storage = require('ali-oss');
//const Compute = require('@alicloud/pop-core');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const utils = require('../../common/utils');
const uuid = require('uuid');
//const ComputeClient = require('./ComputeClient');
const BaseCloudClient = require('./BaseCloudClient');
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;
const Forbidden = errors.Forbidden;

class AliClient extends BaseCloudClient {
  constructor(settings) {
    super(settings);
    this.constructor.validateParams(_.chain(this.settings).value());
    this.storage = this.constructor.createStorageClient(_
      .chain(this.settings)
      .omit('name')
      .set('provider', this.provider)
      .value()
    );
  }

  getContainer(container) {
    if (arguments.length < 1) {
      container = containerName;
    }
    logger.debug("Looking for container " + container);
    return Promise.try(() => {
      return this.storage.listBuckets({
        prefix: container
      })
        .then(buckets => {
          if (buckets.buckets == null) {
            logger.error("Bucket " + container + " does not exists");
          } else if (buckets.buckets.length == 1) {
            return buckets.buckets;
            logger.info("Bucket " + container + " exists");
          } else {
            logger.error("More than 1 Buckets with prefix " + container + " exists");
          }
        })
        .catch(err => {
          logger.error("Bucket " + container + " does not exists");
        });
    });
  }


  list(container, options) {
    if (arguments.length < 2) {
      options = container;
      container = this.containerName;
    }
    return storageClient
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

  listFilenames(prefix, max_keys) {
    const options = {
      prefix: prefix,
      'max-keys': max_keys
    };

    let fileList = [];
    let level = 0;

    function fetchFiles() {
      level++;
      logger.debug(`Fetching recursively at level : ${level}`);
      const promise = new Promise(function (resolve, reject) {
        Promise.try(() => list(containerName, options))
          .then(files => {
            logger.debug('list of files recieved - ', files);
            if (files && files.length > 0) {
              fileList = fileList.concat(files);
              if (files[0].isTruncated === true && level < 10) {
                options.marker = files[files.length - 1].marker;
                return fetchFiles()
                  .then(() => resolve())
                  .catch(err => reject(err));
              }
            }
            logger.debug('end of recursion');
            resolve();
          })
          .catch(err => reject(err));
      });
      return promise;
    }

    return fetchFiles()
      .then(() =>
        _
          .chain(fileList)
          .map(file => file)
          .value());
  }

  remove(container, file) {
    if (arguments.length < 2) {
      file = container;
      container = containerName;
    }

    logger.info("Deleting file " + file + " from container " + container);
    return storageClient
      .useBucket(container)
      .delete(file)
      .then(() => {
        logger.info("Deleted file " + file + " from container " + container);
      })
      .catch(err => {
        logger.error(err.message);
      });
  }

  download(options) {
    return utils.streamToPromise(this.storage.createReadStream(
      options.container, options.remote))
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound, new NotFound(`Object '${options.remote}' not found`));
  }

  upload(options, buffer) {
    return Promise.try(() => {
      return this.storage
        .useBucket(options.container)
        .put(options.remote, buffer)
        .then(result => {
          //console.log(result);
          JSON.parse(buffer);
        })
        .catch(err => {
          logger.error(err)
        })
    });
  }

  uploadJson(container, file, data) {
    if (arguments.length < 3) {
      data = file;
      file = container;
      container = containerName;
    }

    logger.info("Uploading file " + file + " to container " + container);
    return upload({
      container: container,
      remote: file
    }, new Buffer(JSON.stringify(data, null, 2), 'utf8'));
  }

  downloadJson(container, file) {
    if (arguments.length < 2) {
      file = container;
      container = containerName;
    }
    logger.info("Downloading file " + file + " from container " + container);
    return download({
      container: container,
      remote: file
    })
      .then((data) => JSON.parse(data));
  }

  createDiskFromSnapshot(snapshotId, zone, opts = {}) { }

  getDiskMetadata(diskCid, zone) { }

  deleteSnapshot() { }

  getRandomDiskId() { }

  static createComputeClient() { }

  static createStorageClient(options) {
    return Storage({
      region: options.region,
      accessKeyId: options.accessKey,
      accessKeySecret: options.secretKey,
      endpoint: options.endpoint
    });
  }
}

module.exports = AliClient;
