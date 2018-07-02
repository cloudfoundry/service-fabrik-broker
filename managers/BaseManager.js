'use strict';

const _ = require('lodash');
const errors = require('../common/errors');
const logger = require('../common/logger');
const config = require('../common/config');
const eventmesh = require('../eventmesh');
const CONST = require('../common/constants');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class BaseManager {

  registerWatcher() {
    throw new NotImplementedBySubclass('registerWatcher');
  }

  worker() {
    throw new NotImplementedBySubclass('registerWatcher');
  }


  /**
   * @description Patches resource with annotation key lockedByManager and value broker ip
   */
  static acquireProcessingLock(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Trying to acquire processing lock for the backup request for backup guid: ', changedOptions.guid);
    // Set lockedManager annotations to true
    const patchBody = _.cloneDeep(changeObjectBody);
    let currentAnnotations = patchBody.metadata.annotations;
    let patchAnnotations = currentAnnotations ? currentAnnotations : {};
    patchAnnotations.lockedByManager = config.broker_ip;
    patchBody.metadata.annotations = patchAnnotations;
    return eventmesh.apiServerClient.updateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, changedOptions.guid, patchBody)
      .tap((resource) => logger.info(`Successfully acquired processing lock for the backup request for backup guid: ${changedOptions.guid}\n` +
        `Updated resource with annotations is: `, resource));
  }

  /**
   * @description Sets lockedByManager annotation to empty string
   */

  static releaseProcessingLock(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Trying to release processing lock for the backup request for backup guid: ', changedOptions.guid);
    const patchBody = {
      metadata: {
        annotations: {
          lockedByManager: ''
        }
      }
    };
    return eventmesh.apiServerClient.updateResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, changedOptions.guid, patchBody)
      .tap((resource) => logger.info(`Successfully released processing lock for the backup request for backup guid: ${changedOptions.guid}\n` +
        `Updated resource with annotations is: `, resource));
  }

}

module.exports = BaseManager;