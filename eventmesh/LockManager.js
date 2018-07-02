'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const eventmesh = require('./');
const errors = require('../common/errors');
const DeploymentAlreadyLocked = errors.DeploymentAlreadyLocked;
const logger = require('../common/logger');
const CONST = require('../common/constants');
const NotFound = errors.NotFound;
const Conflict = errors.Conflict;
const InternalServerError = errors.InternalServerError;

class LockManager {
  /*
  This method checks whether lock is of write type.
  returns true if lock is present and not expired and it's of type WRITE
  */
  /**
   * @param {string} resourceId - Id (name) of the resource that is being locked. In case of deployment lock, it is instance_id
   */

  isWriteLocked(resourceId) {
    return eventmesh.apiServerClient.getLockDetails(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, resourceId)
      .then(lockDetails => {
        const currentTime = new Date();
        const lockTime = new Date(lockDetails.lockTime);
        const lockTTL = lockDetails.lockTTL ? lockDetails.lockTTL : Infinity;
        if (lockDetails.lockType === CONST.ETCD.LOCK_TYPE.WRITE && ((currentTime - lockTime) < lockTTL)) {
          logger.info(`Resource ${resourceId} was write locked for ${lockDetails.lockedResourceDetails.operation ?
            lockDetails.lockedResourceDetails.operation : 'unknown'} ` +
            `operation with id ${lockDetails.lockedResourceDetails.resourceId} at ${lockTime} `);
          return true;
        }
        return false;
      })
      //TODO -PR- return the lock details in case of locked
      .catch(NotFound, () => false);
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
    //TODO PR - throw error if lock deatils is empty
    if (!lockDetails) {
      lockDetails = {};
    }
    const currentTime = new Date();
    const opts = _.cloneDeep(lockDetails);
    opts.lockedResourceDetails = opts.lockedResourceDetails ? opts.lockedResourceDetails : {};
    opts.lockType = this._getLockType(opts.lockedResourceDetails.operation);
    opts.lockTTL = opts.lockTTL ? opts.lockTTL : Infinity;
    _.extend(opts, {
      'lockTime': currentTime
    });
    logger.debug(`Attempting to acquire lock on resource with resourceId: ${resourceId} `);
    return eventmesh.apiServerClient.getResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, resourceId)
      .then(resource => {
        const resourceBody = resource.body;
        const currentlLockDetails = JSON.parse(resourceBody.spec.options);
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
          const patchBody = _.assign(resourceBody, {
            spec: {
              options: JSON.stringify(opts)
            }
          });
          return eventmesh.apiServerClient.updateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, resourceId, patchBody);
        }
      })
      .tap(() => logger.debug(`Successfully acquired lock on resource with resourceId: ${resourceId}`))
      .catch(err => {
        //TODO -PR - use catch filter
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
          return eventmesh.apiServerClient.createLock(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, body)
            .tap(() => logger.debug(`Successfully acquired lock on resource with resourceId: ${resourceId} `));
        } else if (err instanceof Conflict) {
          // TODO - PR - add details in DeploymentAlreadyLocked
          throw new DeploymentAlreadyLocked(resourceId);
        }
        throw err;
      });
  }

  /*
  To unlock deployment, delete lock resource
  */
  /**
   * @param {string} resourceId - Id (name) of the resource that is being locked. In case of deployment lock, it is instance_id
   * @param {number} [maxRetryCount=CONST.ETCD.MAX_RETRY_UNLOCK] - Max unlock attempts
   */

  unlock(resourceId, maxRetryCount) {
    maxRetryCount = maxRetryCount || CONST.ETCD.MAX_RETRY_UNLOCK;

    function unlockResourceRetry(currentRetryCount) {
      return eventmesh.apiServerClient.deleteLock(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, resourceId)
        .tap(() => logger.debug(`Successfully unlocked resource ${resourceId} `))
        .catch(err => {
          if (err instanceof NotFound) {
            logger.debug(`Successfully Unlocked resource ${resourceId} `);
            return;
          }
          if (currentRetryCount >= maxRetryCount) {
            logger.error(`Could not unlock resource ${resourceId} even after ${maxRetryCount} retries`);
            throw new InternalServerError(`Could not unlock resource ${resourceId} even after ${maxRetryCount} retries`);
          }
          logger.error(`Error in unlocking resource ${resourceId}... Retrying`, err);
          return Promise.delay(CONST.ETCD.RETRY_DELAY)
            .then(() => unlockResourceRetry(resourceId, currentRetryCount + 1));
        });
    }
    logger.debug(`Attempting to unlock resource ${resourceId}`);
    return unlockResourceRetry(0);
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