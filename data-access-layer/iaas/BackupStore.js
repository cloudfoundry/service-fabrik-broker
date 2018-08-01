'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const path = require('path');
const moment = require('moment');
const errors = require('../../common/errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const catalog = require('../../common/models/catalog');
const config = require('../../common/config');
const BaseCloudClient = require('./BaseCloudClient');
const NotFound = errors.NotFound;
const Unauthorized = errors.Unauthorized;
const UnprocessableEntity = errors.UnprocessableEntity;
const Forbidden = errors.Forbidden;
const Gone = errors.Gone;

class BackupStore {

  constructor(cloudProvider, keys, root) {
    this.cloudProvider = cloudProvider;
    this.filename = new Filename(keys, root);
  }

  get containerName() {
    return this.cloudProvider.containerName;
  }

  get containerPrefix() {
    return _.nth(/^(.+)-broker$/.exec(this.containerName), 1);
  }

  listFilenames(prefix, predicate, iteratees, container, dontParseFilename) {
    const options = {
      prefix: prefix,
      container: container
    };

    const self = this;
    let fileList = [];
    let level = 0;

    function fetchFiles() {
      level++;
      logger.debug(`Fetching recursively at level : ${level}`);
      const promise = new Promise(function (resolve, reject) {
        self.cloudProvider
          .list(options)
          .then(files => {
            logger.debug('list of files recieved - ', files);
            if (files && files.length > 0) {
              fileList = fileList.concat(files);
              if (files[0].isTruncated === true && level < 10) {
                options.marker = files[files.length - 1].name;
                return fetchFiles()
                  .then(() => resolve())
                  .catch(err => reject(err));
              }
            }
            logger.debug('end of recursion');
            resolve();
          })
          .catch(err => reject(err));
        //Ideally not catching the error must just bubble the error up in the promise chain.
        //However this is not happening for wrapped promises in this recursion hence this explicit rejection.
      });
      return promise;
    }

    return fetchFiles()
      .then(() =>
        _
        .chain(fileList)
        .map(file => dontParseFilename ? file : this.filename.parse(file.name))
        .filter(predicate)
        .sortBy(iteratees)
        .value());
  }

  getFileNamePrefix() {
    throw new NotImplementedBySubclass('getFileNamePrefix');
  }

  listBackupFiles(options, predicate) {
    const iteratees = ['started_at'];
    const prefix = this.getFileNamePrefix(options);
    return this
      .listFilenames(prefix, predicate, iteratees)
      .map(filenameObject => this.cloudProvider.downloadJson(filenameObject.name), {
        concurrency: 10
      });
  }

  findBackupFilename() {
    throw new NotImplementedBySubclass('findBackupFilename');
  }

  findRestoreFilename(options) {
    const metadata = _.assign({
      operation: 'restore'
    }, options);
    return Promise.resolve(this.filename.create(metadata));
  }

  getBackupFile(options) {
    return this
      .findBackupFilename(options)
      .then(filenameObject => this.cloudProvider.downloadJson(filenameObject.name));
  }

  getRestoreFile(options) {
    return this
      .findRestoreFilename(options)
      .then(filenameObject => this.cloudProvider.downloadJson(filenameObject.name));
  }

  deleteServiceBackup(data, options) {
    return Promise.all([
      data.snapshotId ? this.cloudProvider.deleteSnapshot(data.snapshotId) : Promise.resolve({}),
      this.deleteBackupInServiceContainer(data, options)
    ]);
  }

  putFile(data) {
    if (_.isNil(data.started_at)) {
      data.started_at = this.filename.isoDate();
    }
    const filename = this.filename.stringify(data);
    return this.cloudProvider
      .uploadJson(filename, data)
      .return(data);
  }

  patchFile(filename, newData) {
    return this.cloudProvider
      .downloadJson(filename)
      .tap(data => this.cloudProvider
        .uploadJson(filename, _
          .chain(data)
          .assign(newData)
          .set('finished_at',
            _.get(newData, 'finished_at') ?
            new Date(_.get(newData, 'finished_at')).toISOString() : new Date().toISOString())
          .value()
        )
      );
  }

  patchBackupFile(options, newData) {
    return this
      .findBackupFilename(options)
      .then(filenameObject => this.patchFile(filenameObject.name, newData));
  }

  patchRestoreFile(options, newData) {
    return this
      .findRestoreFilename(options)
      .then(filenameObject => this.patchFile(filenameObject.name, newData));
  }

  deleteBackupFile(options, predicate) {
    return this
      .findBackupFilename(options)
      .then(filenameObject => this.cloudProvider
        .downloadJson(filenameObject.name)
        .then(data => _
          .chain(data)
          .omit('secret', 'agent_ip', 'logs')
          .set('name', filenameObject.name)
          .value()
        )
      )
      .then(data => {
        return Promise.try(() => {
          if (predicate) {
            return predicate(data);
          }
          return true;
        }).then((toBeDeleted) => {
          if (!toBeDeleted) {
            return CONST.ERR_CODES.PRE_CONDITION_NOT_MET;
          }
          const filename = data.name;
          return this
            .deleteServiceBackup(data, options)
            .catch(BaseCloudClient.providerErrorTypes.NotFound, err => {
              logger.warn(`Snapshot/ backup data not found while deleting backup guid ${data.backup_guid}.
              Still deleting metadata for clean up. Error: ${err.message}`);
            })
            .then(() => {
              logger.info('Deleted backup in service container. Deleting meta info in broker container');
              return this.cloudProvider.remove(filename);
            });
        });
      })
      .catchThrow(NotFound, new Gone('Backup does not exist or has already been deleted'));
  }

  deleteRestoreFile(options) {
    return this
      .findRestoreFilename(options)
      .then(filenameObject => this.cloudProvider.remove(filenameObject.name))
      .catch(NotFound, Unauthorized, () => null);
  }

  deleteBackupInServiceContainer(data, options) {
    return Promise
      .try(() => {
        const backup_guid = data.backup_guid;
        let container = options.container;
        if (container === undefined) {
          const service = catalog.getService(data.service_id);
          container = `${this.containerPrefix}-${service.name}`;
        }
        if (!options.force && data.state === 'processing') {
          throw new UnprocessableEntity(`Backup '${backup_guid}' is still in process`);
        }
        if (!options.force && data.trigger === CONST.BACKUP.TRIGGER.SCHEDULED) {
          const retentionStartDate = this.filename.isoDate(moment()
            .subtract(config.backup.retention_period_in_days, 'days').toISOString());
          const backupStartDate = this.filename.isoDate(data.started_at);
          logger.debug(`backupStartDate - ${backupStartDate} | retentionStartDate - ${retentionStartDate}`);
          if (_.gte(backupStartDate, retentionStartDate)) {
            throw new Forbidden(`Delete of scheduled backup not permitted within retention period of ${config.backup.retention_period_in_days} days`);
          }
          if (options.user.name !== config.cf.username) {
            throw new Forbidden(`Permission denined. Scheduled backups can only be deleted by System User`);
          }
        }
        return this.cloudProvider
          .list(container, {
            prefix: `${backup_guid}`
          })
          .each(file => this.cloudProvider.remove(container, file.name));
      });
  }

  listBackupFilenames(backupStartedBefore, options) {
    const iteratees = ['started_at'];

    function getPredicate(isoDate) {
      return function predicate(filenameobject) {
        //backUpStartedBefore defaults to current timestamp as part of isoDate function.
        return (filenameobject.operation === 'backup') &&
          _.lt(filenameobject.started_at, isoDate);
      };
    }
    return Promise
      .try(() => this.filename.isoDate(backupStartedBefore))
      .then(isoDate => this.listFilenames(this.getFileNamePrefix(options), getPredicate(isoDate), iteratees));
  }

  listBackupsOlderThan(options, dateOrDaysOlderThan) {
    const iteratees = ['started_at'];

    let backupStartedBefore;
    // The following check made accept dateOlderThan as both formats
    // 1. number: (say older than 14 days)
    // 2. date: any date format which can be parsed javascript Date interface
    if (Number.isInteger(dateOrDaysOlderThan)) {
      backupStartedBefore = moment().subtract(dateOrDaysOlderThan, 'days').toISOString();
    } else {
      backupStartedBefore = dateOrDaysOlderThan;
    }

    function getPredicate(isoDate) {
      return function predicate(filenameobject) {
        //backUpStartedBefore defaults to current timestamp as part of isoDate function.
        return _.lt(filenameobject.started_at, isoDate);
      };
    }

    return Promise
      .try(() => this.filename.isoDate(backupStartedBefore))
      .then(isoDate => this.listBackupFiles(options, getPredicate(isoDate), iteratees));
  }

  listTransactionLogsOlderThan(options, dateOlderThan, container) {
    const iteratees = ['lastModified'];
    let prefix = options.prefix;

    function getPredicate(isoDate) {
      return function predicate(filenameobject) {
        //transactionLogsDeletionStartDate defaults to current timestamp as part of isoDate function.
        return _.lt(new Date(filenameobject.lastModified).toISOString(), isoDate);
      };
    }

    return Promise
      .try(() => this.filename.isoDate(dateOlderThan))
      .then(isoDate => this.listFilenames(prefix, getPredicate(isoDate), iteratees, container, true));
  }
}

class Filename {

  constructor(keys, root) {
    this.keys = keys;
    this.root = root;
  }

  create(metadata) {
    return _.assign({
      name: this.stringify(metadata)
    }, metadata);
  }

  parse(filename) {
    const [root_folder, operation] = path.dirname(filename).split('/');
    let data = {
      name: filename,
      operation: operation
    };
    if (_.isEqual(this.root, 'root_folder')) {
      data.root_folder = root_folder;
    } else {
      data.tenant_id = root_folder;
    }
    return _
      .chain(this.keys)
      .get(operation)
      .zipObject(path.basename(filename).split('.'))
      .assign(data)
      .tap(filenameObject => {
        if (this.keys.exclude_file_with_root_value !== undefined && this.keys.exclude_file_with_root_value === _.get(filenameObject, this.root)) {
          return;
        }
        if (filenameObject.started_at && this.isValidTimeStamp(filenameObject.started_at)) {
          filenameObject.started_at = this.parseTimestamp(filenameObject.started_at);
        }
      })
      .value();
  }

  stringify(metadata) {
    const operation = metadata.operation;
    const basename = _
      .chain(this.keys)
      .get(operation)
      .map(key => {
        const value = metadata[key];
        if (key === 'started_at') {
          return this.timestamp(value);
        }
        return value;
      })
      .join('.')
      .value() + '.json';
    return path.posix.join(
      _.isEqual(this.root, 'root_folder') ? metadata.root_folder : metadata.tenant_id,
      operation,
      basename
    );
  }

  /**
   * 
   * Checks if the input timestamp is in the following format : yyyy-mm-ddTHH-mm-ssZ
   **/
  isValidTimeStamp(timestamp) {
    return /^[0-9]{4}-(0[1-9]|1[012])-(0[1-9]|[12][0-9]|3[01])T(0[0-9]|1[0-9]|2[0-4])-([0-5][0-9])-([0-5][0-9])Z$/.test(timestamp);
  }

  parseTimestamp(timestamp) {
    if (!timestamp) {
      return;
    }
    const [date, time] = timestamp.split('T');
    return [date, time.replace(/-/g, ':')].join('T');
  }

  timestamp(date) {
    return new Date(date || Date.now())
      .toISOString()
      .replace(/\.\d*/, '')
      .replace(/:/g, '-');
  }

  isoDate(date) {
    //returns ISO Date string stripping out seconds
    return new Date(date || Date.now())
      .toISOString()
      .replace(/\.\d*/, '');
  }
}

module.exports = BackupStore;