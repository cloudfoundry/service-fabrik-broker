'use strict';

const _ = require('lodash');
const eventmesh = require('./');
const errors = require('../../common/errors');
const config = require('../../common/config');
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
        const lockDetails = _.get(resource, 'spec.options');
        const currentTime = new Date();
        const lockTime = new Date(lockDetails.lockTime);
        const lockTTL = this.getLockTTL(_.get(lockDetails, 'lockedResourceDetails.operation'));
        if (lockDetails.lockType === CONST.APISERVER.LOCK_TYPE.WRITE && _.get(resource, 'status.state') !== CONST.APISERVER.RESOURCE_STATE.UNLOCKED && ((currentTime - lockTime) < lockTTL)) {
          logger.info(`Resource ${resourceId} was write locked for ${_.get(lockDetails, 'lockedResourceDetails.operation')} ` +
            `operation with id ${_.get(lockDetails, 'lockedResourceDetails.resourceId')} at ${lockTime} `);
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
   * @param {object} [lockDetails.lockedResourceDetails] - Details of the operation who is trying to acquire the lock
   * @param {string} [lockDetails.lockedResourceDetails.resourceGroup] - Type of resource for which lock is being acquired. ex: backup
   * @param {string} [lockDetails.lockedResourceDetails.resourceType] - Name of resource for which lock is being acquired. ex: defaultbackup
   * @param {string} [lockDetails.lockedResourceDetails.resourceId] - Id of resource for which lock is being acquired. ex: <backup_guid>
   * @param {string} [lockDetails.lockedResourceDetails.operation] - Operation type who is acquiring the lock. ex: backup
   * @param {object} plan - Plan details of instance_id
   */

  lock(resourceId, lockDetails, plan) {
    assert.ok(lockDetails, `Parameter 'lockDetails' is required to acquire lock`);
    assert.ok(lockDetails.lockedResourceDetails, `'lockedResourceDetails' is required to acquire lock`);
    assert.ok(lockDetails.lockedResourceDetails.operation, `'operation' is required to acquire lock`);

    const currentTime = new Date();
    const opts = _.cloneDeep(lockDetails);
    opts.lockType = this._getLockType(_.get(opts, 'lockedResourceDetails.operation'), plan);
    opts.lockTTL = this.getLockTTL(_.get(opts, 'lockedResourceDetails.operation'));
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
        const currentlLockDetails = _.get(resource, 'spec.options');
        const currentLockTTL = this.getLockTTL(_.get(currentlLockDetails, 'lockedResourceDetails.operation'));
        const currentLockTime = new Date(currentlLockDetails.lockTime);
        if (_.get(resource, 'status.state') !== CONST.APISERVER.RESOURCE_STATE.UNLOCKED && (currentTime - currentLockTime) < currentLockTTL) {
          logger.error(`Resource ${resourceId} was locked for ${_.get(currentlLockDetails, 'lockedResourceDetails.operation')} ` +
            `operation with id ${_.get(currentlLockDetails, 'lockedResourceDetails.resourceId')} at ${currentLockTime} `);
          throw new DeploymentAlreadyLocked(resourceId, {
            createdAt: currentLockTime,
            lockForOperation: _.get(currentlLockDetails, 'lockedResourceDetails.operation')
          });
        } else {
          return eventmesh.apiServerClient.updateResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
            resourceId: resourceId,
            metadata: resource.metadata,
            options: opts,
            status: {
              state: CONST.APISERVER.RESOURCE_STATE.LOCKED
            }
          });
        }
      })
      .tap(() => logger.info(`Successfully acquired lock on resource with resourceId: ${resourceId}`))
      .then(resource => _.get(resource, 'body.metadata.resourceVersion'))
      .catch(NotFound, () => {
        return eventmesh.apiServerClient.createResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
            resourceId: resourceId,
            options: opts,
            status: {
              state: CONST.APISERVER.RESOURCE_STATE.LOCKED
            }
          })
          .tap(() => logger.info(`Successfully acquired lock on resource with resourceId: ${resourceId} `))
          .then(resource => _.get(resource, 'body.metadata.resourceVersion'));
      })
      .catch(Conflict, () => {
        return eventmesh.apiServerClient.getResource({
            resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
            resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
            resourceId: resourceId
          })
          .then(resource => {
            const currentlLockDetails = _.get(resource, 'spec.options');
            const currentLockTime = new Date(currentlLockDetails.lockTime);
            throw new DeploymentAlreadyLocked(resourceId, {
              createdAt: currentLockTime,
              lockForOperation: _.get(currentlLockDetails, 'lockedResourceDetails.operation')
            });
          });
      });
  }

  /*
  To unlock deployment, delete lock resource
  */
  /**
   * @param {string} resourceId - Id (name) of the resource that is being locked. In case of deployment lock, it is instance_id
   * @param {string} lockId - lockId which is return by lockManager.lock when lock is acquired
   * @param {number} [maxRetryCount=CONST.APISERVER.MAX_RETRY_UNLOCK] - Max unlock attempts
   */

  unlock(resourceId, lockId, maxRetryCount, retryDelay) {
    assert.ok(resourceId, `Parameter 'resourceId' is required to release lock`);
    // assert.ok(lockId, `Parameter 'lockId' is required to release lock`);
    // TODO-PR: making lockId not mendatory as currently we don't have deployment resources
    // hence from lastOperation call we can't pass lockId for unlock call
    // assert.ok(lockId, `Parameter 'lockId' is required to release lock`);
    maxRetryCount = maxRetryCount || CONST.APISERVER.MAX_RETRY_UNLOCK;
    retryDelay = retryDelay || CONST.APISERVER.RETRY_DELAY;
    logger.info(`Attempting to unlock resource ${resourceId}`);
    return utils.retry(tries => {
      logger.info(`+-> Attempt ${tries + 1} to unlock resource ${resourceId}`);
      const opts = {
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
        resourceId: resourceId,
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.UNLOCKED
        }
      };
      if (lockId) {
        opts.metadata = {
          resourceVersion: lockId
        };
      }
      return eventmesh.apiServerClient.updateResource(opts)
        .tap(() => logger.info(`Successfully unlocked resource ${resourceId} `))
        .catch(Conflict, NotFound, err => logger.info(`Lock on resource ${resourceId} has been updated by some other operation because it expired, no need to unlock now`, err))
        .catch(err => {
          logger.error(`Could not unlock resource ${resourceId} even after ${tries + 1} retries`, err);
          throw new InternalServerError(`Could not unlock resource ${resourceId} even after ${tries + 1} retries`);
        });
    }, {
      maxAttempts: maxRetryCount,
      minDelay: retryDelay
    });
  }

  _getLockType(requestedOperation, plan) {
    const supportedOperations = _.get(plan, 'async_ops_supporting_parallel_sync_ops');
    if (supportedOperations) {
      if (_.includes(supportedOperations, requestedOperation)) {
        return CONST.APISERVER.LOCK_TYPE.READ;
      }
    }

    if (_.includes(CONST.APISERVER.WRITE_OPERATIONS, requestedOperation)) {
      return CONST.APISERVER.LOCK_TYPE.WRITE;
    } else {
      return CONST.APISERVER.LOCK_TYPE.READ;
    }
  }
  getLockTTL(operation) {
    const MS_IN_SEC = 1000;
    const lockTTLKey = _.includes(CONST.OPERATION_TYPE.LIFECYCLE, operation) ? 'lifecycle' : operation;
    return _.get(config, `lockttl.${lockTTLKey}`, CONST.APISERVER.DEFAULT_LOCK_TTL) * MS_IN_SEC;
  }
}

module.exports = LockManager;