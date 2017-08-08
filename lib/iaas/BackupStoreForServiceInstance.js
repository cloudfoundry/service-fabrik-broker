'use strict';

const _ = require('lodash');
const errors = require('../errors');
const BackupStore = require('./BackupStore');
const NotFound = errors.NotFound;

class BackupStoreForServiceInstance extends BackupStore {

  constructor(cloudProvider) {
    const keys = {
      backup: [
        'service_id',
        'plan_id',
        'instance_guid',
        'backup_guid',
        'started_at'
      ],
      restore: [
        'service_id',
        'plan_id',
        'instance_guid'
      ]
    };
    const root = 'space_guid';
    super(cloudProvider, keys, root);
  }

  getFileNamePrefix(options) {
    if (options === undefined) {
      return undefined;
    }
    const space_guid = options.space_guid;
    const service_id = options.service_id;
    const plan_id = options.plan_id;
    const instance_guid = options.instance_guid || options.instance_id;
    let prefix = `${space_guid}/backup`;

    if (service_id) {
      prefix += `/${service_id}`;
      if (plan_id) {
        prefix += `.${plan_id}`;
        if (instance_guid) {
          prefix += `.${instance_guid}`;
        }
      }
    }
    return prefix;
  }

  findBackupFilename(options) {
    const space_guid = options.space_guid;
    const service_id = options.service_id;
    const plan_id = options.plan_id;
    const instance_guid = options.instance_guid || options.instance_id;
    const backup_guid = options.backup_guid;
    const iteratees = ['started_at'];

    let prefix = `${space_guid}/backup`;
    let predicate;
    let message = `No backup found`;

    if (service_id && plan_id && instance_guid) {
      prefix += `/${service_id}.${plan_id}.${instance_guid}`;
      if (backup_guid) {
        prefix += `.${backup_guid}`;
        message = `Backup '${backup_guid}' not found`;
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
    const space_guid = options.space_guid;
    const service_id = options.service_id;
    const plan_id = options.plan_id;
    const iteratees = ['instance_guid', 'started_at'];

    let prefix = `${space_guid}/backup`;
    let predicate;

    if (service_id) {
      prefix += `/${service_id}`;
      if (plan_id) {
        prefix += `.${plan_id}`;
      }
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
    const space_guid = options.space_guid;
    const service_id = options.service_id;
    const plan_id = options.plan_id;
    const iteratees = ['instance_guid'];

    let prefix = `${space_guid}/restore`;
    let predicate;

    if (service_id) {
      prefix += `/${service_id}`;
      if (plan_id) {
        prefix += `.${plan_id}`;
      }
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