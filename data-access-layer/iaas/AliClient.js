'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const Storage = require('ali-oss');
const Compute = require('@alicloud/pop-core');
const logger = require('../../common/logger');
const BaseCloudClient = require('./BaseCloudClient');
const CONST = require('../../common/constants');
const errors = require('../../common/errors');
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;
const Forbidden = errors.Forbidden;
const UnprocessableEntity = errors.UnprocessableEntity;
const Timeout = errors.Timeout;

class AliClient extends BaseCloudClient {
  constructor(settings) {
    super(settings);
    this.storage = this.constructor.createStorageClient(_
      .chain(this.settings)
      .omit('name')
      .set('provider', this.provider)
      .value()
    );
    this.computeClient = this.constructor.createComputeClient(_
      .chain(this.settings)
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
    return Promise.try(() => {
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
    });
  }

  remove(container, file) {
    if (arguments.length < 2) {
      file = container;
      container = this.containerName;
    }

    logger.info('Deleting file ' + file + ' from container ' + container);
    return Promise.try(() => {
      return this.storage
        .useBucket(container)
        .delete(file)
        .then(() => {
          logger.info('Deleted file ' + file + ' from container ' + container);
        });
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

  _getComputeRequestParams(params, tags) {
    let reqParams = _.assign({}, params);
    let i = 1;
    _.forEach(tags, (value, key) => {
      let tag = {};
      tag['Tag.' + i + '.Key'] = key;
      tag['Tag.' + i + '.Value'] = value;
      _.extend(reqParams, tag);
    });
    return reqParams;
  }

  createDiskFromSnapshot(snapshotId, zone, opts = {}) {
    const params = {
      'RegionId': this.settings.region,
      'ZoneId': zone,
      'SnapshotId': snapshotId,
      'DiskCategory': opts.type || 'cloud_ssd'
    };
    const tags = _.assign({}, opts.tags || {}, {
      createdBy: 'service-fabrik'
    });
    const reqParams = this._getComputeRequestParams(params, tags);
    const requestOption = {
      timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
      method: 'POST'
    };
    return Promise
      .try(() => this.computeClient
        .request('CreateDisk', reqParams, requestOption))
      .tap(result => logger.info(`Created disk ${result.DiskId} from snapshot ${snapshotId}, now wait for it to be available...`))
      .then(result => this._waitForDiskAvailability(result.DiskId))
      .then(diskDetails => {
        logger.info(`Created disk ${diskDetails.DiskId} from snapshot ${snapshotId} is now Available with status: ${diskDetails.Status}`);
        return {
          volumeId: diskDetails.DiskId,
          size: diskDetails.Size,
          zone: diskDetails.ZoneId,
          type: diskDetails.Category,
          extra: {
            type: diskDetails.Category,
            sku: diskDetails.Category,
            tags: diskDetails.tags
          }
        };
      })
      .catch(err => {
        logger.error(`Error in creating disk from snapshot ${snapshotId}`, err);
        throw err;
      });
  }

  _waitForDiskAvailability(diskId) {
    function waitForDiskAvailabilityWithTimeout(startTime) {
      return Promise.delay(CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_DELAY)
        .then(() => this._getDiskDetails(diskId))
        .catch(err => {
          logger.error(`Error occured while waiting for volume with diskId: ${diskId}`, err);
          const duration = (new Date() - startTime) / 1000;
          logger.debug(`Polling for availability of disk ${diskId} for duration ${duration}`);
          // 60minutes = 3600Sec
          if(duration > CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_TIMEOUT_IN_SEC) {
            const message = `Volume with diskId ${diskId} is not yet available`;
            logger.error(message);
            throw new Timeout(message);
          }
          return waitForDiskAvailabilityWithTimeout.bind(this)(startTime);
        })
        .then(diskDetails => {
          const state = _.get(diskDetails, 'Status');
          if (state === 'Available' || state === 'In_use') {
            return diskDetails;
          } else{
            const duration = (new Date() - startTime) / 1000;
            logger.debug(`Polling for availability of disk ${diskId} for duration ${duration}`);
            // 60minutes = 3600Sec
            if(duration > CONST.ALI_CLIENT.ECS.AVAILABILITY_POLLER_TIMEOUT_IN_SEC) {
              const message = `Volume with diskId ${diskId} is not yet available. Current state is: ${state}`;
              logger.error(message);
              throw new Timeout(message);
            }
            return waitForDiskAvailabilityWithTimeout.bind(this)(startTime);
          }
        });
    }
    return waitForDiskAvailabilityWithTimeout.bind(this)(new Date());
  }

  _getDiskDetails(diskId) {
    const params = {
      'RegionId': this.settings.region,
      'DiskIds': '[\'' + diskId + '\']'
    };
    const requestOption = {
      timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
      method: 'POST'
    };
    return Promise.try(() => this.computeClient
      .request('DescribeDisks', params, requestOption))
      .then(result => result.Disks.Disk[0]);
  }

  getDiskMetadata(diskId, zone) {
    return this._getDiskDetails(diskId)
      .tap(diskDetails => logger.debug(`Disk Details of ${diskId} are: `, diskDetails))
      .then(diskDetails => {
        return {
          volumeId: diskDetails.DiskId,
          size: diskDetails.Size,
          zone: diskDetails.ZoneId,
          type: diskDetails.Category,
          extra: {
            type: diskDetails.Category,
            sku: diskDetails.Category,
            tags: diskDetails.tags
          }
        };
      })
      .catch(err => {
        logger.error(`Error occured while getting disk metadata ${diskId}`, err);
        throw err;
      });
  }

  deleteSnapshot(snapshotId) {
    // https://www.alibabacloud.com/help/doc-detail/25525.htm?spm=a2c63.p38356.b99.470.2ecd123fj8j9jB
    // Force params to delete snapshots which have been used to create some disk
    // Thing to remember is that disk can't be reinitialised if parent snapshot is deleted
  
    const params = {
      'SnapshotId': snapshotId,
      'Force': true
    };
    const requestOption = {
      timeout: CONST.ALI_CLIENT.ECS.REQ_TIMEOUT,
      method: 'POST'
    };
    return Promise
      .try(() => this.computeClient
        .request('DeleteSnapshot', params, requestOption))
      .tap(() => logger.info(`Deleted snapshot ${snapshotId}`))
      .catch(err => {
        logger.error(`Error occured while deleting snapshot ${snapshotId}`, err);
        throw err;
      });
  }

  static createComputeClient(options) {
    return new Compute({
      accessKeyId: options.keyId,
      accessKeySecret: options.key,
      apiVersion: CONST.ALI_CLIENT.ECS.API_VERSION,
      endpoint: 'https://ecs.' + options.region + '.aliyuncs.com'
    });
  }

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
