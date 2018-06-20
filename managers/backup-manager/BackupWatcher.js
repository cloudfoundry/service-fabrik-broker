'use strict';

const Promise = require('bluebird');
const catalog = require('../../broker/lib/models/catalog');
const eventmesh = require('../../eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const fabrik = require('./');
const BaseManager = require('../BaseManager');
const DBManager = require('../../broker/lib/fabrik/DBManager');

/* jshint nonew:false */
new DBManager(); //to start the BnRStatusPoller

class DefaultBackupManager extends BaseManager {

  registerWatcher() {
    logger.info(`Registering Backup watcher`);
    return eventmesh.server.registerWatcher('backup', 'defaultbackup', this.worker)
      .catch(e => logger.error('Caught errro', e));
  }

  worker(change) {
    logger.info('resource changed', change);
    const value = change.object.spec.options;
    logger.info('Changed value:', value);
    const changedValue = JSON.parse(value);
    logger.info('Parsed value:', changedValue);
    if (change.type === 'MODIFIED' && change.object.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
      logger.info('Triggering backup:', changedValue);
      return Promise.try(() => {
          const plan = catalog.getPlan(changedValue.plan_id);
          return fabrik.createManager(plan);
        }).then(manager => manager.startBackup(changedValue))
        .catch(e => logger.error('Caught error while starting backup', e));
    } else if (change.object.status.state === CONST.OPERATION.ABORT) {
      logger.info(`State key is set to abort. Triggering abort`);
      const opts = {
        resourceId: changedValue.instance_guid,
        annotationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
        annotationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
        annotationId: changedValue.guid
      };
      return eventmesh.server.getAnnotationOptions(opts)
        .then(options => {
          const changedValue = JSON.parse(options);
          return Promise.try(() => {
            const plan = catalog.getPlan(changedValue.plan_id);
            return fabrik.createManager(plan);
          }).then(manager => manager.abortLastBackup(changedValue));
        }).catch(err => logger.info('Caught error', err));
    }
  }
}

const defaultBackupManager = new DefaultBackupManager();
defaultBackupManager.registerWatcher();