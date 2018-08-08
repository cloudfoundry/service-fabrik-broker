'use strict';

const _ = require('lodash');
const eventmesh = require('./');
const errors = require('../../common/errors');
const DeploymentAlreadyLocked = errors.DeploymentAlreadyLocked;
const utils = require('../../common/utils');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const NotFound = errors.NotFound;
const Conflict = errors.Conflict;
const assert = require('assert');
const InternalServerError = errors.InternalServerError;

class LockManager {
  /*
  This method checks whether lock is of write type.
  returns true if lock is present and not expired and it's of type WRITE
  */
  /**
   * @param {string} resourceId - Id (name) of the resource that is being locked. In case of deployment lock, it is instance_id
   */

  checkWriteLockStatus(resourceId) {
    return eventmesh.apiServerClient.getResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
        resourceId: resourceId
      })
      .then(resource => {
        const lockDetails = resource.spec.options;
        const currentTime = new Date();
        const lockTime = new Date(lockDetails.lockTime);
        const lockTTL = lockDetails.lockTTL ? lockDetails.lockTTL : Infinity;
        if (lockDetails.lockType === CONST.ETCD.LOCK_TYPE.WRITE && ((currentTime - lockTime) < lockTTL)) {
          logger.info(`Resource ${resourceId} was write locked for ${lockDetails.lockedResourceDetails.operation ?
            lockDetails.lockedResourceDetails.operation : 'unknown'} ` +
            `operation with id ${lockDetails.lockedResourceDetails.resourceId} at ${lockTime} `);
          return {
            isWriteLocked: true,
            lockDetails: lockDetails
          };
        }
        return {
          isWriteLocked: false,
          lockDetails: undefined
        };
      })
      .catch(NotFound, () => {
        return {
          isWriteLocked: false,
          lockDetails: undefined
        };
      });
  }

  /*
  Lock resource structure
  {
      metadata : {
          name : instance_id,
      },
      spec: {
          options: JSON.stringify({
                lockType: <Read/Write>,
                lockTime: <time in UTC when lock was acquired, can be updated when one wants to refresh lock>,
                lockTTL: <lock ttl in miliseconds=> set to Infinity if not provided>,
                lockedResourceDetails: {
                    resourceGroup: <type of resource who is trying to acquire lock ex. backup>
                    resourceType: <name of resource who is trying to acquire lock ex. defaultbackup>
                    resourceId: <id of resource who is trying to acquire lock ex.  backup_guid>
                    operation: <operation of locker ex. update/backup>
              }
          })
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

  /**
   * @param {string} resourceId - Id (name) of the resource that is being locked. In case of deployment lock, it is instance_id
   * @param {object} lockDetails - Details of the lock that is to be acquired
   * @param {number} [lockDetails.lockTTL=Infinity] - TTL in miliseconds for the lock that is to be acquired
   * @param {string} lockDetails.lockType - Type of lock ('READ'/'WRITE')
   * @param {object} [lockDetails.lockedResourceDetails] - Details of the operation who is trying to acquire the lock
   * @param {string} [lockDetails.lockedResourceDetails.resourceGroup] - Type of resource for which lock is being acquired. ex: backup
   * @param {string} [lockDetails.lockedResourceDetails.resourceType] - Name of resource for which lock is being acquired. ex: defaultbackup
   * @param {string} [lockDetails.lockedResourceDetails.resourceId] - Id of resource for which lock is being acquired. ex: <backup_guid>
   * @param {string} [lockDetails.lockedResourceDetails.operation=unknown] - Operation type who is acquiring the lock. ex: backup
   */

  lock(resourceId, lockDetails) {
    assert.ok(lockDetails, `Parameter 'lockDetails' is required to acquire lock`);
    assert.ok(lockDetails.lockedResourceDetails, `'lockedResourceDetails' is required to acquire lock`);
    assert.ok(lockDetails.lockedResourceDetails.operation, `'operation' is required to acquire lock`);

    const currentTime = new Date();
    const opts = _.cloneDeep(lockDetails);
    opts.lockType = this._getLockType(opts.lockedResourceDetails.operation);
    opts.lockTTL = opts.lockTTL ? opts.lockTTL : Infinity;
    _.extend(opts, {
      'lockTime': opts.lockTime ? opts.lockTime : currentTime
    });
    logger.info(`Attempting to acquire lock on resource with resourceId: ${resourceId} `);
    return eventmesh.apiServerClient.getResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
        resourceId: resourceId
      })
      .then(resource => {
        const currentlLockDetails = resource.spec.options;
        const currentLockTTL = currentlLockDetails.lockTTL ? currentlLockDetails.lockTTL : Infinity;
        const currentLockTime = new Date(currentlLockDetails.lockTime);
        if ((currentTime - currentLockTime) < currentLockTTL) {
          logger.error(`Resource ${resourceId} was locked for ${currentlLockDetails.lockedResourceDetails.operation} ` +
            `operation with id ${currentlLockDetails.lockedResourceDetails.resourceId} at ${currentLockTime} `);
          throw new DeploymentAlreadyLocked(resourceId, {
            createdAt: currentLockTime,
            lockForOperation: currentlLockDetails.lockedResourceDetails.operation
          });
        } else {
          return eventmesh.apiServerClient.updateResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
            resourceId: resourceId,
            options: opts
          });
        }
      })
      .tap(() => logger.info(`Successfully acquired lock on resource with resourceId: ${resourceId}`))
      .catch(NotFound, () => {
        return eventmesh.apiServerClient.createResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
            resourceId: resourceId,
            options: opts
          })
          .tap(() => logger.info(`Successfully acquired lock on resource with resourceId: ${resourceId} `));
      })
      .catch(Conflict, () => {
        return eventmesh.apiServerClient.getResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
            resourceId: resourceId
          })
          .then(resource => {
            const currentlLockDetails = resource.spec.options;
            const currentLockTime = new Date(currentlLockDetails.lockTime);
            throw new DeploymentAlreadyLocked(resourceId, {
              createdAt: currentLockTime,
              lockForOperation: currentlLockDetails.lockedResourceDetails.operation
            });
          });
      });
  }

  /*
  To unlock deployment, delete lock resource
  */
  /**
   * @param {string} resourceId - Id (name) of the resource that is being locked. In case of deployment lock, it is instance_id
   * @param {number} [maxRetryCount=CONST.ETCD.MAX_RETRY_UNLOCK] - Max unlock attempts
   */

  unlock(resourceId, maxRetryCount, retryDelay) {
    assert.ok(resourceId, `Parameter 'resourceId' is required to release lock`);
    maxRetryCount = maxRetryCount || CONST.ETCD.MAX_RETRY_UNLOCK;
    retryDelay = retryDelay || CONST.APISERVER.RETRY_DELAY;
    logger.info(`Attempting to unlock resource ${resourceId}`);
    return utils.retry(tries => {
      logger.info(`+-> Attempt ${tries + 1} to unlock resource ${resourceId}`);
      return eventmesh.apiServerClient.deleteResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
          resourceId: resourceId
        })
        .tap(() => logger.info(`Successfully unlocked resource ${resourceId} `))
        .catch(err => {
          if (err instanceof NotFound) {
            logger.info(`Successfully Unlocked resource ${resourceId} `);
            return;
          }
          logger.error(`Could not unlock resource ${resourceId} even after ${tries + 1} retries`);
          throw new InternalServerError(`Could not unlock resource ${resourceId} even after ${tries + 1} retries`);
        });
    }, {
      maxAttempts: maxRetryCount,
      minDelay: retryDelay
    });
  }

  _getLockType(operation) {
    if (_.includes(CONST.APISERVER.WRITE_OPERATIONS, operation)) {
      return CONST.ETCD.LOCK_TYPE.WRITE;
    } else {
      return CONST.ETCD.LOCK_TYPE.READ;
    }
  }
}

module.exports = LockManager;