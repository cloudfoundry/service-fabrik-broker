'use strict';

const _ = require('lodash');
const config = require('../common/config');
const logger = require('../common/logger');
const errors = require('../common/errors');
const ETCDLockError = errors.ETCDLockError;
const CONST = require('./constants');

const {
  Etcd3
} = require('etcd3');
const client = new Etcd3({
  hosts: config.etcd.url,
  credentials: {
    rootCertificate: Buffer.from(config.etcd.ssl.ca, 'utf8'),
    privateKey: Buffer.from(config.etcd.ssl.key, 'utf8'),
    certChain: Buffer.from(config.etcd.ssl.crt, 'utf8')
  }
});

class LockManager {
  /*
  Lock is tracked via the key value "resource/lock/details". 
  The value is a JSON type and the structure looks like the following.
  {count: INT, operationType:STRING}
  when a lock is taken, count value is set to 1.
  operationType value is either "READ or "WRITE", depending on if the ongoing operation will make sync operations like bind/unbind wait for it.

  This value is read and updated to acquire lock. In order to make this two different operations synchronous, we do it taking a lock on the "resource/lock" key, which would ensure synchrounous execution of the read and update operation.

  Lock Algorithm looks like the following
      1. Lock "resource/lock"
      2. Check "resource/lock/details" value
      3. if lock value > 1 then lock is already acquired by someone, 
         unlock "resource/lock" and throw exception.
      4. else, set the lock details as 
         {count: 1, operationType: "READ"} 
      5. release the lock on "resource/lock"
  */
  lock(resource, operationType) {
    const lock = client.lock(resource + CONST.LOCK_KEY_SUFFIX);
    let lockDetailsChanged = false;
    return lock.ttl(CONST.LOCK_TTL).acquire()
      .then(() => {
        return client.get(resource + CONST.LOCK_DETAILS_SUFFIX).json();
      })
      .then(lockDetails => {
        if (_.get(lockDetails, 'count') > 0) {
          return lock.release().then(() => {
            throw new ETCDLockError(`Could not acquire lock for ${resource} as it is already locked.`);
          });
        } else {
          const newLockDetails = {};
          newLockDetails.count = 1;
          newLockDetails.operationType = operationType;
          return client.put(resource + CONST.LOCK_DETAILS_SUFFIX).value(JSON.stringify(newLockDetails));
        }
      })
      .then(() => {
        lockDetailsChanged = true;
        return lock.release();
      })
      .catch(e => {
        if (!lockDetailsChanged) {
          throw new ETCDLockError(e.message);
        } else {
          logger.info('Resource unlock failed. However, now throwing error and letting lock successful as unlock happens automatically after 5 seconds');
        }
      });
  }

  /*
  Unlock operation needs to only reset the lock details value and make the count as 0. 
  As it is a single opetation, we do it directly, without having any external lock surrounding it.
  Caller whould re-try if unlock fails.
  */
  unlock(resource) {
    const newLockDetails = {};
    newLockDetails.count = 0;
    newLockDetails.operationType = '';
    return client.put(resource + CONST.LOCK_DETAILS_SUFFIX).value(JSON.stringify(newLockDetails));
  }

  /*
  Synchronous operations like Bind and Unbind do not have to lock while execution, but they need to ensure if a resource is going through WRITE operations like restore or update. 
  Hence, this isWriteLocked function only checks the lock details count.
  Unless the count is 1 and operaitonType is "WRITE", they return false for all other cases.
  */
  isWriteLocked(resource) {
    return client.get(resource + CONST.LOCK_DETAILS_SUFFIX).json()
      .then(lockDetails => {
        if (_.get(lockDetails, 'count') === 0) {
          return false;
        } else if (_.get(lockDetails, 'operationType') === CONST.LOCK_TYPE.WRITE) {
          return true;
        } else {
          return false;
        }
      });
  }

}

module.exports = LockManager;