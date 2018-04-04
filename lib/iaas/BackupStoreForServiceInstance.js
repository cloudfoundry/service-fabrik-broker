'use strict';

const _ = require('lodash');
const errors = require('../errors');
const BackupStore = require('./BackupStore');
const CONST = require('../constants');
const NotFound = errors.NotFound;

class BackupStoreForServiceInstance extends BackupStore {

  constructor(cloudProvider) {
    const keys = {
      backup: [
        'service_id',
        'instance_guid',
        'backup_guid',
        'started_at'
      ],
      restore: [
        'service_id',
        'instance_guid'
      ],
      exclude_file_with_root_value: `${CONST.FABRIK_OUT_OF_BAND_DEPLOYMENTS.ROOT_FOLDER_NAME}`
    };
    const root = 'tenant_id';
    super(cloudProvider, keys, root);
  }

  getFileNamePrefix(options) {
    if (options === undefined) {
      return undefined;
    }
    const tenant_id = options.tenant_id;
    const service_id = options.service_id;
    const instance_guid = options.instance_guid || options.instance_id;
    let prefix = `${tenant_id}/backup`;

    if (service_id) {
      prefix += `/${service_id}`;
      if (instance_guid) {
        prefix += `.${instance_guid}`;
      }
    }
    return prefix;
  }

  findBackupFilename(options) {
    const tenant_id = options.tenant_id;
    const service_id = options.service_id;
    const instance_guid = options.instance_guid || options.instance_id;
    const backup_guid = options.backup_guid;
    const time_stamp = options.time_stamp;
    const iteratees = ['started_at'];

    let prefix = `${tenant_id}/backup`;
    let predicate;
    let message = `No backup found`;
    let isoDate;

    function getPredicate(isoDate) {
      return function predicate(filenameobject) {
        //backUpStartedBefore defaults to current timestamp as part of isoDate function.
        return _.lt(filenameobject.started_at, isoDate);
      };
    }

    if (service_id && instance_guid) {
      prefix += `/${service_id}.${instance_guid}`;
      if (backup_guid) {
        prefix += `.${backup_guid}`;
        message = `Backup '${backup_guid}' not found`;
      } else if (time_stamp) {
        isoDate = this.filename.isoDate(time_stamp);
        predicate = getPredicate(isoDate);
        message = `No backup found for time stamp '${time_stamp}'`;
      } else {
        message = `No backup found for service instance '${instance_guid}'`;
      }
    } else if (backup_guid) {
      predicate = ['backup_guid', backup_guid];
      message = `Backup '${backup_guid}' not found`;
    }

    return this
      .listFilenames(prefix, predicate, iteratees)
      .then(filenameObjects => {
        if (filenameObjects.length < 1) {
          throw new NotFound(message);
        }
        return _.last(filenameObjects);
      });
  }

  listLastBackupFiles(options) {
    const tenant_id = options.tenant_id;
    const service_id = options.service_id;
    const iteratees = ['instance_guid', 'started_at'];

    let prefix = `${tenant_id}/backup`;
    let predicate;

    if (service_id) {
      prefix += `/${service_id}`;
    }

    return this
      .listFilenames(prefix, predicate, iteratees)
      .then(filenameObjects => _
        .chain(filenameObjects)
        .groupBy('instance_guid')
        .values()
        .map(_.last)
        .value()
      )
      .map(filenameObject => this.cloudProvider.downloadJson(filenameObject.name), {
        concurrency: 10
      });
  }

  listLastRestoreFiles(options) {
    const tenant_id = options.tenant_id;
    const service_id = options.service_id;
    const iteratees = ['instance_guid'];

    let prefix = `${tenant_id}/restore`;
    let predicate;

    if (service_id) {
      prefix += `/${service_id}`;
    }

    return this
      .listFilenames(prefix, predicate, iteratees)
      .then(filenameObjects => _
        .chain(filenameObjects)
        .groupBy('instance_guid')
        .values()
        .map(_.last)
        .value()
      )
      .map(filenameObject => this.cloudProvider.downloadJson(filenameObject.name), {
        concurrency: 10
      });
  }

}
module.exports = BackupStoreForServiceInstance;