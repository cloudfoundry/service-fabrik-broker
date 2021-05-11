'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const S3 = require('aws-sdk/clients/s3');
const logger = require('@sf/logger');
const {
  CONST,
  errors: {
    NotFound,
    Unauthorized
  },
  commonFunctions: {
    streamToPromise
  }
} = require('@sf/common-utils');

const ComputeClient = require('./ComputeClient');
const BaseCloudClient = require('./BaseCloudClient');

class AwsClient extends BaseCloudClient {
  constructor(settings) {
    super(settings);
    this.constructor.validateParams(this.settings);
    this.storage = this.constructor.createStorageClient(_
      .chain(this.settings)
      .omit('name')
      .set('provider', this.provider)
      .value()
    );
    this.blockstorage = this.constructor.createComputeClient(_
      .chain(this.settings)
      .set('provider', this.provider)
      .value()
    );
    this.storage.listObjectsAsync = Promise.promisify(this.storage.listObjects, {});
    this.storage.deleteObjectAsync = Promise.promisify(this.storage.deleteObject, {});
    this.storage.uploadAsync = Promise.promisify(this.storage.upload, {});
  }

  createDiskFromSnapshot(snapshotId, zones, options = {}) {
    let tags = [];
    if (options.tags) {
      options.tags.createdBy = 'service-fabrik';
    } else {
      options.tags = {
        createdBy: 'service-fabrik'
      };
    }
    tags.push({
      ResourceType: 'volume',
      Tags: _.keys(options.tags).map(tagKey => ({
        Key: tagKey,
        Value: options.tags[tagKey]
      }))
    });
    return Promise.try(() => {
      return this.blockstorage
        .createVolume({
          AvailabilityZone: _.isArray(zones) ? zones[0] : zones,
          SnapshotId: snapshotId,
          VolumeType: _.get(options, 'type', 'gp2'),
          TagSpecifications: tags
        })
        .promise();
    })
      .then(volume => {
        const describeReq = {
          VolumeIds: [volume.VolumeId]
        };
        return this.blockstorage.waitFor('volumeAvailable', describeReq).promise();
      })
      .then(volResponse => volResponse.Volumes[0])
      .then(volume => {
        const responseTags = volume.Tags || [];
        const outTags = {};
        _.forEach(responseTags, tag => {
          outTags[tag.Key] = tag.Value;
        });
        return {
          volumeId: volume.VolumeId,
          size: volume.Size,
          zone: volume.AvailabilityZone,
          type: volume.VolumeType,
          extra: {
            type: volume.VolumeType,
            tags: outTags
          }
        };
      });
  }

  getDiskMetadata(diskId) {
    return Promise.try(() => {
      return this.blockstorage
        .describeVolumes({
          VolumeIds: [diskId]
        })
        .promise();
    })
      .then(diskResponse => diskResponse.Volumes[0])
      .then(volume => {
        const responseTags = volume.Tags || [];
        const outTags = {};
        _.forEach(responseTags, tag => {
          outTags[tag.Key] = tag.Value;
        });
        return {
          volumeId: volume.VolumeId,
          size: volume.Size,
          zone: volume.AvailabilityZone,
          type: volume.VolumeType,
          extra: {
            type: volume.VolumeType,
            tags: outTags
          }
        };
      });
  }

  getContainer(container) {
    if (arguments.length < 1) {
      container = this.containerName;
    }

    let s3Options = {
      Bucket: container
    };

    return this.storage.
      listObjectsAsync(s3Options)
      .then(data => {
        return data;
      });
  }

  list(container, options) {
    if (arguments.length < 2) {
      options = container;
      container = this.containerName;
    }
    let s3Options = {
      Bucket: container
    };

    if (options.marker) {
      s3Options.Marker = options.marker;
    }

    if (options.prefix) {
      s3Options.Prefix = options.prefix;
    }

    if (options.maxKeys) {
      s3Options.MaxKeys = options.maxKeys;
    }

    return this.storage
      .listObjectsAsync(s3Options)
      .then(data => {
        let isTruncated = data.IsTruncated;
        let list = data.Contents;

        list.forEach(element => {
          element.name = element.Key;
          element.lastModified = element.LastModified;
          delete element.Key;
          delete element.LastModified;
        });

        const files = [];
        _.each(list, file => files.push(_
          .chain(file)
          .pick('name', 'lastModified')
          .set('isTruncated', isTruncated)
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
      .deleteObjectAsync({
        Bucket: container,
        Key: file
      })
      .catch(BaseCloudClient.providerErrorTypes.Unauthorized, err => {
        logger.error(err.message);
        throw new Unauthorized('Authorization at the cloud storage provider failed');
      })
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound, new NotFound(`Object '${file}' not found`));
  }

  download(options) {
    return Promise
      .try(() => this.storage.getObject(options).createReadStream())
      .then(streamToPromise)
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound, new NotFound(`Object '${options.Key}' not found`));
  }

  upload(options) {
    let s3Settings = {
      partSize: 5 * 1024 * 1024,
      queueSize: 1
    };
    return this.storage.uploadAsync(options, s3Settings);
  }

  uploadJson(container, file, data) {
    if (arguments.length < 3) {
      data = file;
      file = container;
      container = this.containerName;
    }
    logger.info('Uploading file ' + file + ' to container ' + container);
    return this
      .upload({
        Bucket: container,
        Key: file,
        Body: new Buffer(JSON.stringify(data, null, 2), 'utf8')
      });
  }

  downloadJson(container, file) {
    if (arguments.length < 2) {
      file = container;
      container = this.containerName;
    }
    logger.info('Downloading file ' + file + ' from container ' + container);
    return this
      .download({
        Bucket: container,
        Key: file
      })
      .then(data => {
        const response = JSON.parse(data);
        response.trigger = response.trigger === CONST.BACKUP.TRIGGER.MANUAL ? CONST.BACKUP.TRIGGER.SCHEDULED : response.trigger;
        // The above conversion is done to handle existing CRON Jobs which set this trigger as 'manual' even for scheduled Jobs
        // Above conversion can be removed and code changes can be revereted 14 days after the current fix goes live
        return response;
      })
      .catchThrow(SyntaxError, new NotFound(`Object '${file}' not found`));
  }

  deleteSnapshot(snapshotId) {
    return Promise
      .try(() => {
        return this.blockstorage
          .deleteSnapshot({
            SnapshotId: snapshotId
          })
          .promise()
          .then(retval => {
            logger.info(`Deleted snapshot ${snapshotId}`, retval);
          })
          .catch(err => {
            logger.error(`Error occured while deleting snapshot ${snapshotId}`, err);
            throw err;
          });
      });
  }

  static validateParams(options) {
    if (!options) {
      throw new Error('AwsClient can not be instantiated as backup provider config not found');
    }
    if (!options.keyId) {
      throw new Error('AwsClient can not be instantiated as keyId not found in backup provider config');
    }
    if(!options.key) {
      throw new Error('AwsClient can not be instantiated as key not found in backup provider config');
    }
    if(!options.region) {
      throw new Error('AwsClient can not be instantiated as region not found in backup provider config');
    } 
  
    return true;
  }

  static createStorageClient(options) {
    let s3Config = {
      accessKeyId: options.keyId,
      secretAccessKey: options.key,
      region: options.region,
      maxRetries: CONST.SDK_CLIENT.AWS.MAX_RETRIES
    };
    if (Number.isInteger(options.max_retries) &&
      options.max_retries > 0) {
      s3Config = _.assign(s3Config, {
        maxRetries: options.max_retries
      });
    }

    return new S3(s3Config);
  }

  static createComputeClient(settings) {
    return ComputeClient.createComputeClient(settings).value();
  }
}

module.exports = AwsClient;
