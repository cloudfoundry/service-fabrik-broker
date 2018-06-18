'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const catalog = require('../../broker/lib/models/catalog');
const eventmesh = require('../../eventmesh');
const logger = require('../../common/logger');
const fabrik = require('./');
const BaseManager = require('../BaseManager');
const DBManager = require('../../broker/lib/fabrik/DBManager');
new DBManager(); //to start the BnRStatusPoller

class DefaultBackupManager extends BaseManager {

  registerWatcher() {
    logger.info(`Registering Backup watcher`)
    eventmesh.server.registerWatcher('backup/default', this.worker, true);
  }

  worker(change) {
    const value = change.object.spec.options
    logger.info('resource changed', change);
    logger.info('Changed value:', value);
    const changedValue = JSON.parse(value);
    if (change.object.metadata.labels.status == CONST.APISERVER.STATE.IN_QUEUE) {
      return Promise.try(() => {
        const plan = catalog.getPlan(changedValue.plan_id);
        return fabrik.createManager(plan);
      }).then(manager => manager.startBackup(changedValue));
    } else if (change.object.metadata.labels.status == CONST.OPERATION.ABORT) {
      logger.info(`State key is set to abort. Triggering abort`);
      const opts = {
        resourceId: changedValue.instance_guid,
        annotationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
        annotationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
        annotationId: changedValue.guid
      }
      return eventmesh.server.getAnnotationOptions(opts)
        .then(options => {
          const changedValue = JSON.parse(options);
          return Promise.try(() => {
            const plan = catalog.getPlan(changedValue.plan_id);
            return fabrik.createManager(plan);
          }).then(manager => {
            return manager.abortLastBackup(changedValue)
          });
        }).catch(err => logger.info('Caught error', err))
    }
  }
}

const defaultBackupManager = new DefaultBackupManager();
defaultBackupManager.registerWatcher();
