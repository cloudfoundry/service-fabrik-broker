'use strict';

const Promise = require('bluebird');
const catalog = require('../../broker/lib/models/catalog');
const eventmesh = require('../../eventmesh');
const config = require('../../common/config');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const bm = require('./');
const BaseManager = require('../BaseManager');
const DBManager = require('../../broker/lib/fabrik/DBManager');
const errors = require('../../common/errors');
const Conflict = errors.Conflict;

/* jshint nonew:false */
new DBManager(); //to start the BnRStatusPoller

class DefaultBackupManager extends BaseManager {

  static _processBackup(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering backup with the following options:', changedOptions);
    const plan = catalog.getPlan(changedOptions.plan_id);
    return bm.createManager(plan)
      .then(manager => manager.startBackup(changedOptions));
  }

  static _processAbort(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    return eventmesh.apiServerClient.getOperationOptions({
        resourceId: changedOptions.instance_guid,
        operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
        operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
        operationId: changedOptions.guid
      })
      .then(options => {
        return Promise.try(() => {
          const plan = catalog.getPlan(options.plan_id);
          return bm.createManager(plan);
        }).then(manager => manager.abortLastBackup(options));
      });
  }

  static _processDelete(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    return eventmesh.apiServerClient.getOperationOptions({
        resourceId: changedOptions.instance_guid,
        operationName: CONST.APISERVER.ANNOTATION_NAMES.BACKUP,
        operationType: CONST.APISERVER.ANNOTATION_TYPES.BACKUP,
        operationId: changedOptions.guid
      })
      .then(options => {
        return Promise.try(() => {
          const plan = catalog.getPlan(options.plan_id);
          return bm.createManager(plan);
        }).then(manager => manager.deleteBackup(options));
      });
  }

  /**
   * @description Registers backup watcher with worker callback
   */
  // Register watcher is refreshed every 20 mins as API Server has a min time out of 30 mins after which it closes the watch.
  //TODO-PR - Extract it in a different function
  registerWatcher() {
    logger.debug(`Registering Backup watcher`);
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.OPERATION.ABORT},${CONST.APISERVER.RESOURCE_STATE.DELETE})`;
    return eventmesh.apiServerClient.registerWatcher('backup', 'defaultbackup', this.worker, queryString)
      .then(stream => {
        logger.info(`Successfully set watcher with query string:`, queryString);
        return setTimeout(() => {
          try {
            logger.info(`Refreshing stream after ${CONST.APISERVER.WATCHER_REFRESH_INTERVAL}`);
            stream.abort();
            return this.registerWatcher();
          } catch (err) {
            logger.error('Error caught in the set timout callback');
            throw err;
          }
        }, CONST.APISERVER.WATCHER_REFRESH_INTERVAL);
      })
      .catch(e => {
        logger.error('Failed registering watcher with error:', e);
        throw e;
      });
  }
  /**
   * @description This method does following in order
   * 1. Tries to acquire processing lock => In case of HA, Only one backup manager process will process the request
   * 2. Processes the request based on the state of the changed resource
   * 3. Release processing lock
   * @param {object} change - Change object that comes as part of apiserver watch event
   */


  //TODO-PR - Move the locking part of the code as part of the Base Manager, 
  //Use something like this.
  // handleResource(change){
  // return this._preProcessResource(change)
  //             .then(()=> this.processResource(change))
  //             .then(()=> this.postProcessResource(change))
  //              .catch((err)=> logger.error(`Error occurred ....`)); //Dont need to care what type of error just log. 
  //                //see if this can be put in finally.
  // } 

  // _preProcessResource(){
  // //Code about acquiring processing lock goes here.
  // }

  // processResource(change){
  //   throw 'Must be implemented by subclass'; // Individual base manage managers just implement this.
  // }
  // _postProcessResource(){
  //  //code to handle release processing lock  goes here. 
  // }
  worker(change) {

    logger.debug('Changed Resource:', change);
    logger.debug('Changed resource options:', change.object.spec.options);
    const changeObjectBody = change.object;
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.debug('Changed resource options(parsed):', changedOptions);
    let processingLockConflict = false;
    if (changeObjectBody.metadata.annotations && changeObjectBody.metadata.annotations.lockedByManager === config.broker_ip) {
      // Don't have to process as this is event generated by acquireProcessLock
      logger.debug(`Backup request for guid ${changedOptions.guid} is already being processed by process with ip ${changeObjectBody.metadata.annotations.lockedByManager}`);
    } else {
      // Acquire processing lock so that in HA scenerio, only one backup-manager process processes the request
      return Promise.try(() => {
          if (!changeObjectBody.metadata.annotations || changeObjectBody.metadata.annotations.lockedByManager === '') {
            return BaseManager.acquireProcessingLock(changeObjectBody)
              .catch(err => {
                if (err instanceof Conflict) {
                  processingLockConflict = true;
                  logger.info(`Not able to acquire processing lock, Backup request for guid ${changedOptions.guid} is probably picked by other worker`);
                } else {
                  logger.error(`Error while trying to get processing lock for backup with guid ${changedOptions.guid}`, err);
                }
                throw err;
              });
          } else {
            processingLockConflict = true;
            logger.info(`Backup request for guid ${changedOptions.guid} is picked by other process with ip ${changeObjectBody.metadata.annotations.lockedByManager}`);
          }
        })
        .then(() => {
          if (!processingLockConflict) {
            if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
              return DefaultBackupManager._processBackup(changeObjectBody);
            } else if (changeObjectBody.status.state === CONST.OPERATION.ABORT) {
              return DefaultBackupManager._processAbort(changeObjectBody);
            } else if (changeObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
              return DefaultBackupManager._processDelete(changeObjectBody);
            }
          }
        })
        .catch(e => {
          // If conflict error is in acquiring processingLock then don't throw error
          if (!processingLockConflict) {
            logger.error(`Caught error while starting backup ${changedOptions.guid}`, e);
          }
        })
        .then(() => {
          if (!processingLockConflict) {
            return BaseManager.releaseProcessingLock(changeObjectBody)
              .catch(e => logger.error(`Caught error while releasing processing lock ${changedOptions}:`, e));
          }
        });
    }
  }
}

const defaultBackupManager = new DefaultBackupManager();
defaultBackupManager.registerWatcher();