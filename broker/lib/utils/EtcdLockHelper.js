'use strict';

const Promise = require('bluebird');
const logger = require('../logger');
const CONST = require('../constants');
const lockManager = require('../../../eventmesh').lockManager;
const ETCDLockError = require('../errors').ETCDLockError;

function unlockEtcdResource(resource, maxRetryCount) {
  maxRetryCount = maxRetryCount || CONST.ETCD.MAX_RETRY_UNLOCK;

  function unlockResourceRetry(currentRetryCount) {
    return lockManager.unlock(resource)
      .then(() => logger.info(`Successfully unlocked resource ${resource}`))
      .catch(() => {
        if (currentRetryCount >= maxRetryCount) {
          logger.error(`Could not unlock resource ${resource} even after ${maxRetryCount} retries`);
          throw new ETCDLockError(`Could not unlock resource ${resource} even after ${maxRetryCount} retries`);
        }
        logger.error(`Error in unlocking resource ${resource}... Retrying`);
        return Promise.delay(CONST.ETCD.RETRY_DELAY)
          .then(() => unlockResourceRetry(resource, currentRetryCount + 1));
      })
  }
  logger.info(`Attempting to unlock resource ${resource}`);
  return unlockResourceRetry(0);
}

exports.unlockEtcdResource = unlockEtcdResource;