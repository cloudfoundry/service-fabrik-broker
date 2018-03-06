'use strict';
const _ = require('lodash');
const Promise = require('bluebird');
const GcpStorage = require('@google-cloud/storage');
const logger = require('../logger');
const errors = require('../errors');
const utils = require('../utils');
const ComputeClient = require('./ComputeClient');
const BaseCloudClient = require('./BaseCloudClient');
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;
const Forbidden = errors.Forbidden;

class GcpClient extends BaseCloudClient {
  constructor(settings) {
    super(settings);
    this.constructor.validateParams(_.chain(this.settings).value());
    this.storageClient = this.constructor.createStorageClient(_
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

    return this.storageClient
      .bucket(container)
      .get();
  }

  list(container, options) {
    if (arguments.length < 2) {
      options = container;
      container = this.containerName;
    }
    const prefix = options ? options.prefix : null;
    const queryOptions = {};
    if (prefix) {
      queryOptions.prefix = prefix;
    }
    queryOptions.autoPaginate = (options && options.autoPaginate) ? options.autoPaginate : true;

    return Promise.try(() => {
      return this.storageClient
        .bucket(container)
        .getFiles(queryOptions)
        .then(results => {
          const resultFiles = results[0];
          const files = []; 
          _.each(resultFiles, file => files.push(_       
            .chain(file)       
            .pick('name')       
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
    logger.debug(`Deleting file ${file} in container ${container} `);
    return Promise.try(() => {
        return this.storageClient
          .bucket(container)
          .file(file)
          .delete();
      })
      .catch(BaseCloudClient.providerErrorTypes.Unauthorized, err => {
        logger.error(err.message);
        throw new Unauthorized(`Authorization at google cloud storage provider failed while deleting blob ${file} in container ${container}`);
      })
      .catch(BaseCloudClient.providerErrorTypes.Forbidden, err => {
        logger.error(err.message);
        throw new Forbidden(`Authentication at google cloud storage provider failed while deleting blob ${file} in container ${container}`);
      })
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound,
        new NotFound(`Object '${file}' not found while deleting in container ${container}`));
  }

  download(options) {
    return utils.streamToPromise(this.storageClient
        .bucket(options.container)
        .file(options.remote)
        .createReadStream())
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound, new NotFound(`Object '${options.remote}' not found`));
  }

  upload(options, buffer) {
    return new Promise((resolve, reject) => {
      function cleanup() {
        uploadedStream.removeListener('finish', onfinish);
        uploadedStream.removeListener('error', onerror);
      }

      function onerror(err) {
        cleanup();
        reject(err);
      }

      function onfinish() {
        cleanup();
        resolve(JSON.parse(buffer));
      }

      let uploadedStream = this.storageClient
        .bucket(options.container)
        .file(options.remote)
        .createWriteStream();

      uploadedStream.on('error', onerror);
      uploadedStream.on('finish', onfinish);
      uploadedStream.end(buffer);
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
        remote: file
      }, new Buffer(JSON.stringify(data, null, 2), 'utf8'));
  }

  downloadJson(container, file) {
    if (arguments.length < 2) {
      file = container;
      container = this.containerName;
    }
    return this
      .download({
        container: container,
        remote: file
      })
      .then((data) => JSON.parse(data))
      .catchThrow(SyntaxError, new NotFound(`Object '${file}' not found`));
  }

  deleteSnapshot(snapshotName) {
    return Promise
      .try(() => {
        return this.computeClient
          .snapshot(snapshotName)
          .delete()
          .then(retval => logger.info(`Deleted snapshot ${snapshotName}`, retval));
      })
      .catch(BaseCloudClient.providerErrorTypes.Unauthorized, err => {
        logger.error(err.message);
        throw new Unauthorized(`Authorization at google compute failed while deleting snapshot ${snapshotName}`);
      })
      .catch(BaseCloudClient.providerErrorTypes.Forbidden, err => {
        logger.error(err.message);
        throw new Forbidden(`Authentication at google compute failed while deleting snapshot ${snapshotName}`);
      })
      .catchThrow(BaseCloudClient.providerErrorTypes.NotFound,
        new NotFound(`Snapshot ${snapshotName} not found while deleting`));
  }

  static validateParams(options) {
    if (!options) {
      throw new Error('GcpClient can not be instantiated as backup provider config not found');
    } else {
      if (!options.projectId || !options.credentials) {
        throw new Error('GcpClient can not be instantiated as project id or credentials not found in backup provider config');
      }
    }
    return true;
  }

  static createStorageClient(options) {
    return GcpStorage({
      projectId: options.projectId,
      credentials: options.credentials
    });
  }

  static createComputeClient(settings) {
    return ComputeClient.createComputeClient(settings).value();
  }
}

module.exports = GcpClient;