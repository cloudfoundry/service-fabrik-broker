'use strict';

const _ = require('lodash');
const pkgcloud = require('pkgcloud');
const Promise = require('bluebird');
const logger = require('../../common/logger');
const errors = require('../../common/errors');
const utils = require('../../common/utils');
const ComputeClient = require('./ComputeClient');
const CONST = require('../../common/constants');
const BaseCloudClient = require('./BaseCloudClient');

const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;

class CloudProviderClient extends BaseCloudClient {
  constructor(settings) {
    super(settings);
    this.storage = this.constructor.createStorageClient(_
      .chain(this.settings)
      .omit('name')
      .set('provider', this.provider)
      .value()
    );
    this.storage.getFilesAsync = Promise.promisify(this.storage.getFiles, {
      multiArgs: true
    });
    this.storage.getContainerAsync = Promise.promisify(this.storage.getContainer, {});
    this.storage.removeFileAsync = Promise.promisify(this.storage.removeFile, {});
    this.blockstorage = this.constructor.createComputeClient(_
      .chain(this.settings)
      .set('provider', this.provider)
      .value()
    );
    this.storage.on('log::*', function onmessage(message, obj) {
      const event = _.nth(this.event.split('::'), 1);
      const level = _.includes([
        'warn',
        'info',
        'verbose',
        'debug'
      ], event) ? event : 'debug';
      if (obj) {
        logger.log(level, message, obj);
      } else {
        logger.log(level, message);
      }
    });
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
      .then(diskResponse => diskResponse.Volumes[0])
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
    return this.storage.getContainerAsync(container);
  }

  list(container, options) {
    if (arguments.length < 2) {
      options = container;
      container = this.containerName;
    }
    return this.storage
      .getFilesAsync(container, options)
      .then(listOfFiles => {
        let list = [];
        let isTruncated = false;
        if (listOfFiles[0] instanceof Array) {
          list = listOfFiles[0];
          isTruncated = _.get(listOfFiles[1], 'isTruncated') ? true : false;
        } else {
          list = listOfFiles;
        }
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
    logger.debug(`Deleting file ${file} in container ${container} `);
    return this.storage
      .removeFileAsync(container, file)
      .catch(BaseCloudClient.providerErrorTypes.Unauthorized, err => {
        logger.error(err.message);
        throw new Unauthorized('Authorization at the cloud storage provider failed');
      })
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound, new NotFound(`Object '${file}' not found`));
  }

  download(options) {
    return Promise
      .try(() => this.storage.download(options))
      .then(utils.streamToPromise)
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound, new NotFound(`Object '${options.remote}' not found`));
  }

  upload(options, buffer) {
    return new Promise((resolve, reject) => {
      function cleanup() {
        stream.removeListener('error', onerror);
        stream.removeListener('success', onsuccess);
      }

      function onerror(err) {
        cleanup();
        reject(err);
      }

      function onsuccess(file) {
        cleanup();
        resolve(file.toJSON());
      }

      const stream = this.storage.upload(options);
      stream.once('error', onerror);
      stream.once('success', onsuccess);
      stream.end(buffer);
    });
  }

  uploadJson(container, file, data) {
    if (arguments.length < 3) {
      data = file;
      file = container;
      container = this.containerName;
    }
    return this
      .upload({
        container: container,
        remote: file,
        headers: {
          'content-type': 'application/json'
        }
      }, new Buffer(JSON.stringify(data, null, 2), 'utf8'));
  }

  downloadJson(container, file) {
    if (arguments.length < 2) {
      file = container;
      container = this.containerName;
    }
    logger.debug(`Downloading file: ${file} from container ${container}`);
    return this
      .download({
        container: this.containerName,
        remote: file
      })
      .then((data) => {
        const response = JSON.parse(data);
        response.trigger = response.trigger === CONST.BACKUP.TRIGGER.MANUAL ? CONST.BACKUP.TRIGGER.SCHEDULED : response.trigger;
        //The above conversion is done to handle existing CRON Jobs which set this trigger as 'manual' even for scheduled Jobs
        //Above conversion can be removed and code changes can be revereted 14 days after the current fix goes live
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
          .then(retval => logger.info(`Deleted snapshot ${snapshotId}`, retval))
          .catch(err => {
            logger.error(`Error occured while deleting snapshot ${snapshotId}`, err);
            throw err;
          });
      });
  }

  static createStorageClient(options) {
    if (options.authUrl && options.keystoneAuthVersion) {
      const pattern = new RegExp(`\/${options.keystoneAuthVersion}\/?$`);
      options.authUrl = options.authUrl.replace(pattern, '');
    }
    return pkgcloud.storage.createClient(options);
  }

  static createComputeClient(settings) {
    return ComputeClient.createComputeClient(settings).value();
  }
}

module.exports = CloudProviderClient;