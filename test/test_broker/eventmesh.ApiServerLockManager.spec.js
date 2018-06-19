'use strict';

const Promise = require('bluebird');
// const lockManager = require('../../eventmesh').lockManager;
const CONST = require('../../common/constants');
const proxyquire = require('proxyquire');
const errors = require('../../common/errors');
const notFound = errors.NotFound;
const resourceType = 'lock';
const resourceName = 'deploymentlocks';

function buildLockResourceOptions(lockType, lockTime, lockTTL) {
  return JSON.stringify({
    lockType: lockType,
    lockTime: lockTime ? lockTime : new Date(),
    lockTTL: lockTTL ? lockTTL : Infinity
  });
}
const lockoptions = {
  lockId1: buildLockResourceOptions(CONST.ETCD.LOCK_TYPE.WRITE),
  lockId2: buildLockResourceOptions(CONST.ETCD.LOCK_TYPE.WRITE, new Date(), 1),
  lockId3: buildLockResourceOptions(CONST.ETCD.LOCK_TYPE.READ)
};
const apiServerLockManager = proxyquire('../../eventmesh/ApiServerLockManager', {
  './': {
    'server': {
      'getLockResourceOptions': function (resourceType, resourceName, resourceId) {
        return Promise.try(() => {
          if (lockoptions[resourceId])
            return lockoptions[resourceId];
          else {
            // return Promise.throw(new notFound('Lock not found'));
            throw new notFound('Lock not found hahahha');
          }
        })
      }
    }
  }
});

describe('eventmesh', () => {
  describe('LockManager', () => {
    describe('#isWriteLocked', () => {
      it('should return true if write lock is present and ttl has not expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId1')
          .then(result => {
            expect(result).to.eql(true);
          });
      });
      it('should return false if write lock is present and ttl has expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId2')
          .then(result => {
            expect(result).to.eql(false);
          });
      });
      it('should return false if non write lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId3')
          .then(result => {
            expect(result).to.eql(false);
          });
      });
      // it.only('should return false if no lock is present', () => {
      //     const lockManager = new apiServerLockManager();
      //     return lockManager.isWriteLocked('lockId4')
      //         .then(result => {
      //             console.log(result);
      //             expect(result).to.eql(false);
      //         });
      // });
    });
  });
});