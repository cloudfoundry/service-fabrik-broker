'use strict';

const _ = require('lodash');
const errors = require('../common/errors');
const logger = require('../common/logger');
const config = require('../common/config');
const eventmesh = require('../eventmesh');
const CONST = require('../common/constants');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;
const Conflict = errors.Conflict;

class BaseManager {
  registerWatcher(resourceGroup, resourceType, queryString) {
    logger.debug(`Registering watcher for resourceGroup ${resourceGroup} of type ${resourceType} with queryString as ${queryString}`);
    return eventmesh.apiServerClient.registerWatcher(resourceGroup, resourceType, this.handleResource.bind(this), queryString)
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
   * @description Patches resource with annotation key lockedByManager and value broker ip
   */
  _acquireProcessingLock(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Trying to acquire processing lock for request with options: ', changedOptions);
    // Set lockedManager annotations to true
    const patchBody = _.cloneDeep(changeObjectBody);
    let currentAnnotations = patchBody.metadata.annotations;
    let patchAnnotations = currentAnnotations ? currentAnnotations : {};
    patchAnnotations.lockedByManager = config.broker_ip;
    patchBody.metadata.annotations = patchAnnotations;
    const resourceDetails = eventmesh.apiServerClient.parseResourceDetailsFromSelfLink(changeObjectBody.metadata.selfLink);
    return eventmesh.apiServerClient.updateResource(resourceDetails.resourceGroup, resourceDetails.resourceType, changeObjectBody.metadata.name, patchBody)
      .tap((resource) => logger.info(`Successfully acquired processing lock for request with options: ${JSON.stringify(changedOptions)}\n` +
        `Updated resource with annotations is: `, resource));
  }

  /**
   * @description Sets lockedByManager annotation to empty string
   */

  _releaseProcessingLock(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Trying to release processing lock for request with options: ', changedOptions);
    const patchBody = {
      metadata: {
        annotations: {
          lockedByManager: ''
        }
      }
    };
    const resourceDetails = eventmesh.apiServerClient.parseResourceDetailsFromSelfLink(changeObjectBody.metadata.selfLink);
    return eventmesh.apiServerClient.updateResource(resourceDetails.resourceGroup, resourceDetails.resourceType, changeObjectBody.metadata.name, patchBody)
      .tap((resource) => logger.info(`Successfully released processing lock for the request with options: ${JSON.stringify(changedOptions)}\n` +
        `Updated resource with annotations is: `, resource));
  }

  _preProcessRequest(objectBody, processingLockStatus) {
    const options = JSON.parse(objectBody.spec.options);
    // Acquire processing lock so that in HA scenerio, only one backup-manager process processes the request
    return Promise.try(() => {
      if (!objectBody.metadata.annotations || objectBody.metadata.annotations.lockedByManager === '') {
        return this._acquireProcessingLock(objectBody)
          .catch(err => {
            processingLockStatus.conflict = true;
            if (err instanceof Conflict) {
              logger.info(`Not able to acquire processing lock, Request with options ${JSON.stringify(options)} is probably picked by other worker`);
            } else {
              logger.error(`Error while trying to get processing lock for request with options ${JSON.stringify(options)}`, err);
            }
            throw err;
          });
      } else {
        processingLockStatus.conflict = true;
        logger.info(`Request with options ${JSON.stringify(options)} is picked by other process with ip ${objectBody.metadata.annotations.lockedByManager}`);
      }
    });
  }

  _postProcessRequest(objectBody) {
    const options = JSON.parse(objectBody.spec.options);
    return this._releaseProcessingLock(objectBody)
      .catch(err => logger.error(`Caught error while releasing processing lock for request ${JSON.stringify(options)}:`, err));
  }

  processRequest() {
    throw new NotImplementedBySubclass('processRequest');
  }

  handleResource(changeObject) {
    logger.debug('Changed Resource:', changeObject);
    logger.debug('Changed resource options:', changeObject.object.spec.options);
    const changeObjectBody = changeObject.object;
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.debug('Changed resource options(parsed):', changedOptions);
    const processingLockStatus = {
      conflict: false
    };
    if (changeObjectBody.metadata.annotations && changeObjectBody.metadata.annotations.lockedByManager === config.broker_ip) {
      // Don't have to process as this is event generated by acquireProcessLock
      logger.debug(`Request with options ${JSON.stringify(changedOptions)} is already being processed by process with ip ${changeObjectBody.metadata.annotations.lockedByManager}`);
    } else {
      return this._preProcessRequest(changeObjectBody, processingLockStatus)
        .then(() => {
          if (!processingLockStatus.conflict) {
            // console.log(Object.getOwnPropertyNames(ParentClass))
            // return ParentClass.prototype.processRequest.call(this, changeObject);
            return this.processRequest(changeObjectBody);
          }
        })
        .catch(err => {
          if (!processingLockStatus.conflict) {
            logger.error(`Caught error while processing request with options ${JSON.stringify(changedOptions)}`, err);
          }
        })
        .finally(() => {
          if (!processingLockStatus.conflict) {
            return this._postProcessRequest(changeObjectBody);
          }
        });
    }
  }

}

module.exports = BaseManager;