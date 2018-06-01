'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const catalog = require('../../broker/lib/models/catalog');
const eventmesh = require('../../eventmesh');
const logger = require('../../common/logger');
const fabrik = require('./');
const BaseManager = require('../BaseManager');

class DefaultBackupManager extends BaseManager {

  registerWatcher() {
    logger.info(`Registering Backup watcher`)
    eventmesh.server.registerWatcher('backup/default', this.worker, true);
  }

  worker(change) {
    logger.info('Change key:', change.key.toString());
    logger.info('Change value:', change.value.toString());
    const changedKey = change.key.toString();
    let keys = _.split(changedKey, '/');
    logger.info('key 4', keys[4]);
    if (keys.length === 5 && keys[4] === 'options') {
      const changedValue = JSON.parse(change.value.toString());
      logger.info('Values are : ', changedValue);
      return Promise.try(() => {
        const plan = catalog.getPlan(changedValue.plan_id);
        return fabrik.createManager(plan);
      }).then(manager => manager.startBackup(changedValue));
    } else if (keys[4] === 'state' && change.value.toString() == 'abort') {
      logger.info('State key set for abort:', keys[4], change.value.toString());
      const opts = {
        resourceId: keys[2],
        annotationName: 'backup',
        annotationType: 'default',
        annotationId: keys[3]
      }
      return eventmesh.server.getAnnotationOptions(opts)
        .then(options => {
          const changedValue = JSON.parse(options);
          logger.info('Abort option', changedValue);
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

module.exports = DefaultBackupManager;