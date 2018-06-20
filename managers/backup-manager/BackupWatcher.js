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
  }

  worker(change) {
    logger.info('Changed Resource:', change);
    logger.debug('Changed resource options:', change.object.spec.options);
    const changedOptions = JSON.parse(change.object.spec.options);
    logger.debug('Changed resource options(parsed):', changedOptions);
    if (change.object.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
      logger.info('Triggering backup with the following options:', changedOptions);
      return Promise.try(() => {
          const plan = catalog.getPlan(changedOptions.plan_id);
          return fabrik.createManager(plan);
        }).then(manager => manager.startBackup(changedOptions))
        .catch(e => {
          logger.error(`Caught error while starting backup ${changedOptions.guid}`, e);
          throw e
        });
    } else if (change.object.status.state === CONST.OPERATION.ABORT) {
      logger.info(`State key is set to abort. Triggering abort`);
      return eventmesh.server.getAnnotationOptions({
          resourceId: changedOptions.instance_guid,
          annotationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
          annotationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
          annotationId: changedOptions.guid
        })
        .then(options => {
          const changedOptions = JSON.parse(options);
          return Promise.try(() => {
            const plan = catalog.getPlan(changedOptions.plan_id);
            return fabrik.createManager(plan);
          }).then(manager => manager.abortLastBackup(changedOptions));
        }).catch(err => logger.info('Caught error', err));
    }
  }
}

const defaultBackupManager = new DefaultBackupManager();
defaultBackupManager.registerWatcher();