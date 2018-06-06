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
    const changedKey = change.key.toString();
    const value = change.value.toString();
    logger.info('Key changed', changedKey);
    logger.info('Changed value:', value);
    let keys = _.split(changedKey, '/');
    if (keys.length === 5 && keys[4] === 'options') {
      const changedValue = JSON.parse(value);
      return Promise.try(() => {
        const plan = catalog.getPlan(changedValue.plan_id);
        return fabrik.createManager(plan);
      }).then(manager => manager.startBackup(changedValue));
    } else if (keys[4] === 'state' && change.value.toString() == 'abort') {
      logger.info(`State key is set to abort. Triggering abort`);
      const opts = {
        resourceId: keys[2],
        annotationName: 'backup',
        annotationType: 'default',
        annotationId: keys[3]
      }
      return eventmesh.server.getAnnotationOptions(opts)
        .then(options => {
          const changedValue = JSON.parse(options);
          logger.info('Starting abort with following options:', changedValue);
          return Promise.try(() => {
            const plan = catalog.getPlan(changedValue.plan_id);
            return fabrik.createManager(plan);
          }).then(manager => {
            return manager.abortLastBackup(manager.getTenantGuid(changedValue.context), changedValue.instance_guid, true)
          });
        })
    }
  }
}

const defaultBackupManager = new DefaultBackupManager();
defaultBackupManager.registerWatcher();