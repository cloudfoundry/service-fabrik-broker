'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('./config');
const CONST = require('./constants');

const {
  Etcd3
} = require('etcd3');
const client = new Etcd3({
  hosts: config.etcd.url
});

class LockManager {
  /*
  Lock is tracked via the key value "resource/lock/details". 
  The value is a JSON type and the structure looks like the following.
  {count: INT, operaitonType:STRING}
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
    const lock = client.lock(resource + "/lock");
    return lock.ttl(5).acquire()
      .then(() => {
        return client.get(resource + "/lock/details").json();
      })
      .then(lockDetails => {
        if (_.get(lockDetails, 'count') > 0) {
          return lock.release().then(() => {
            throw Error('Could not acquire lock');
          });
        } else {
          const newLockDetails = {};
          newLockDetails.count = 1;
          newLockDetails.operationType = operationType;
          return client.put(resource + "/lock/details").value(JSON.stringify(newLockDetails));
        }
      })
      .then(() => lock.release())
      .catch(e => {
        throw e;
      });
  }

  /*
  Unlock operation needs to only reset the lock details value and make the count as 0. 
  As it is a single opetation, we do it directly, without having any external lock surrounding it.
  */
  unlock(resource) {
    const newLockDetails = {};
    newLockDetails.count = 0;
    newLockDetails.operationType = '';
    return client.put(resource + "/lock/details").value(JSON.stringify(newLockDetails));
  }

  /*
  Synchronous operations like Bind and Unbind do not have to lock while execution, but they need to ensure if a resource is going through WRITE operations like restore or update. 
  Hence, this isWriteLocked function only checks the lock details count.
  Unless the count is 1 and operaitonType is "WRITE", they return false for all other cases.
  */
  isWriteLocked(resource) {
    return client.get(resource + "/lock/details").json()
      .then(lockDetails => {
        if (_.get(lockDetails, 'count') == 0) {
          return false;
        } else if (_.get(lockDetails, 'operationType') == CONST.LOCK_TYPE.WRITE) {
          return true;
        } else {
          return false;
        }
      })
  }

}

module.exports = LockManager;