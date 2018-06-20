'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const eventmesh = require('./');
const errors = require('../common/errors');
const EtcdLockError = errors.EtcdLockError;
const logger = require('../common/logger');
const CONST = require('../common/constants');
const NotFound = errors.NotFound;
const Conflict = errors.Conflict;

class ApiServerLockManager {
  /*
  This method checks whether lock is of write type.
  returns true if lock is present and not expired and it's of type WRITE
  */

  isWriteLocked(resourceId) {
    return eventmesh.server.getLockResourceOptions(CONST.APISERVER.RESOURCE_TYPES.LOCK, CONST.APISERVER.RESOURCE_NAMES.DEPLOYMENT_LOCKS, resourceId)
      .then(options => {
        const currentTime = new Date();
        const lockDetails = JSON.parse(options);
        const lockTime = new Date(lockDetails.lockTime);
        const lockTTL = lockDetails.lockTTL ? lockDetails.lockTTL : Infinity;
        if (lockDetails.lockType === CONST.ETCD.LOCK_TYPE.WRITE && ((currentTime - lockTime) < lockTTL)) {
          logger.info(`Resource ${resourceId} was write locked for ${lockDetails.lockedResourceDetails.operation} ` +
            `operation with id ${lockDetails.lockedResourceDetails.resourceId} at ${lockTime}`);
          return true;
        }
        return false;
      })
      .catch(err => {
        if (err instanceof NotFound) {
          return false;
        }
        throw err;
      });
  }

  /*
  Lock reosurce structure
  {
      metadata : {
          name : instance_id,
      },
      spec: {
          options: {
          JSON.stringify({
              lockType: <Read/Write>,
              lockTime: <time in UTC when lock was acquired, can be updated when one wants to refresh lock>,
              lockTTL: <lock ttl in miliseconds=> set to Infinity if not provided>,
              lockedResourceDetails: {
                  resourceType: <type of resource who is trying to acquire lock ex. backup>
                  resourceName: <name of resource who is trying to acquire lock ex. defaultbackup>
                  resourceId: <id of resource who is trying to acquire lock ex.  backup_guid>
                  operation: <operation of locker ex. update/backup>
              }
          })    
          }
      }
  }
  Lock is tracked via resource of resource group lock and resource type deploymentlock.
  id of the resource is instance_id.
  To lock the deployment we create a new resource of resourceType deploymentlock.
  If the resource is already present then deployment can't be locked.
  Lock Algorithm looks like the following
      1. Create resource lock/deploymentlock/instance_id
      2. If resource is already present than can't acquire lock
      3. Check lockdetails from spec.options, if TTL is expired than update the lockdetails
      4. else can't acquire lock
  */

  lock(resourceId, lockDetails) {
    if (!lockDetails) {
      lockDetails = {};
    }
    const currentTime = new Date();
    const opts = _.cloneDeep(lockDetails);
    opts.lockTime = new Date();
    opts.lockTTL = opts.lockTTL ? opts.lockTTL : Infinity;
    _.extend(opts, {
      'lockTime': currentTime
    });
    logger.info(`Attempting to acquire lock on resource with resourceId: ${resourceId}`);
    return eventmesh.server.getResource(CONST.APISERVER.RESOURCE_TYPES.LOCK, CONST.APISERVER.RESOURCE_NAMES.DEPLOYMENT_LOCKS, resourceId)
      .then(resource => {
        const resourceBody = resource.body;
        const currentlLockDetails = JSON.parse(resourceBody.spec.options);
        const currentLockTTL = currentlLockDetails.lockTTL ? currentlLockDetails.lockTTL : Infinity;
        const currentLockTime = new Date(currentlLockDetails.lockTime);
        if ((currentTime - currentLockTime) < currentLockTTL) {
          logger.error(`Resource ${resourceId} was locked for ${currentlLockDetails.lockedResourceDetails.operation} ` +
            `operation with id ${currentlLockDetails.lockedResourceDetails.resourceId} at ${currentLockTime}`);
          throw new EtcdLockError(`Resource ${resourceId} was locked for ${currentlLockDetails.lockedResourceDetails.operation} ` +
            `operation with id ${currentlLockDetails.lockedResourceDetails.resourceId} at ${currentLockTime}`);
        } else {
          const patchBody = _.assign(resourceBody, {
            spec: {
              options: JSON.stringify(opts)
            }
          });
          return eventmesh.server.updateLockResource(CONST.APISERVER.RESOURCE_TYPES.LOCK, CONST.APISERVER.RESOURCE_NAMES.DEPLOYMENT_LOCKS, resourceId, patchBody);
        }
      })
      .tap(() => logger.info(`Successfully acquired lock on resource with resourceId: ${resourceId}`))
      .catch(err => {
        if (err instanceof NotFound) {
          const spec = {
            options: JSON.stringify(opts)
          };
          const status = {
            locked: 'true'
          };
          const body = {
            metadata: {
              name: resourceId
            },
            spec: spec,
            status: status
          };
          return eventmesh.server.createLockResource(CONST.APISERVER.RESOURCE_TYPES.LOCK, CONST.APISERVER.RESOURCE_NAMES.DEPLOYMENT_LOCKS, body)
            .tap(() => logger.info(`Successfully acquired lock on resource with resourceId: ${resourceId}`));
        } else if (err instanceof Conflict) {
          throw new EtcdLockError(err.message);
        }
        throw err;
      });
  }

  /*
  To unlock deployment, delete lock resource
  */

  unlock(resourceId, maxRetryCount) {
    maxRetryCount = maxRetryCount || CONST.ETCD.MAX_RETRY_UNLOCK;

    function unlockResourceRetry(currentRetryCount) {
      return eventmesh.server.deleteLockResource(CONST.APISERVER.RESOURCE_TYPES.LOCK, CONST.APISERVER.RESOURCE_NAMES.DEPLOYMENT_LOCKS, resourceId)
        .tap(() => logger.info(`Successfully unlocked resource ${resourceId}`))
        .catch(err => {
          if (err instanceof NotFound) {
            logger.info(`Successfully Unlocked resource ${resourceId}`);
            return;
          }
          if (currentRetryCount >= maxRetryCount) {
            logger.error(`Could not unlock resource ${resourceId} even after ${maxRetryCount} retries`);
            throw new EtcdLockError(`Could not unlock resource ${resourceId} even after ${maxRetryCount} retries`);
          }
          logger.error(`Error in unlocking resource ${resourceId}... Retrying`, err);
          return Promise.delay(CONST.ETCD.RETRY_DELAY)
            .then(() => unlockResourceRetry(resourceId, currentRetryCount + 1));
        });
    }
    logger.info(`Attempting to unlock resource ${resourceId}`);
    return unlockResourceRetry(0);
  }
}

module.exports = ApiServerLockManager;