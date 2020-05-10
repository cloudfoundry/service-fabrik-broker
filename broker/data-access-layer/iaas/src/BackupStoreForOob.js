'use strict';

const _ = require('lodash');
const {
  errors: {
    NotFound
  }
} = require('@sf/common-utils');
const BackupStore = require('./BackupStore');

class BackupStoreForOob extends BackupStore {

  constructor(cloudProvider) {
    const keys = {
      backup: [
        'deployment_name',
        'backup_guid',
        'started_at'
      ],
      restore: [
        'deployment_name'
      ]
    };

    const root = 'root_folder';
    super(cloudProvider, keys, root);
  }

  getFileNamePrefix(options) {
    if (options === undefined) {
      return undefined;
    }
    const root_folder = options.root_folder;
    const deployment_name = options.deployment_name;
    let prefix = `${root_folder}/backup`;

    if (deployment_name) {
      prefix += `/${deployment_name}`;
    }
    return prefix;
  }

  findBackupFilename(options) {
    const root_folder = options.root_folder;
    const deployment_name = options.deployment_name;
    const backup_guid = options.backup_guid;
    const iteratees = ['started_at'];

    let prefix = `${root_folder}/backup`;
    let predicate;
    let message = 'No backup found';

    if (deployment_name) {
      prefix += `/${deployment_name}`;
      if (backup_guid) {
        prefix += `.${backup_guid}`;
        message = `Backup '${backup_guid}' not found`;
      } else {
        message = `No backup found for deployment '${deployment_name}'`;
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

}

module.exports = BackupStoreForOob;
