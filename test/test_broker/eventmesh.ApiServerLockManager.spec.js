'use strict';

const Promise = require('bluebird');
// const lockManager = require('../../eventmesh').lockManager;
const CONST = require('../../common/constants');
const proxyquire = require('proxyquire');
const errors = require('../../common/errors');
const NotFound = errors.NotFound;
const InternalServerError = errors.InternalServerError;
const ETCDLockError = errors.ETCDLockError;
// const resourceType = 'lock';
// const resourceName = 'deploymentlocks';

const startTime = new Date();

function buildLockResourceOptions(lockType, lockTime, lockTTL) {
  return JSON.stringify({
    lockType: lockType,
    lockTime: lockTime ? lockTime : startTime,
    lockTTL: lockTTL ? lockTTL : Infinity,
    lockedResourceDetails: {
      resourceType: 'backup',
      resourceName: 'defaultbackup',
      resourceId: 'guid',
      operation: 'backup'
    }
  });
}
const lockoptions = {
  lockId1: buildLockResourceOptions(CONST.ETCD.LOCK_TYPE.WRITE),
  lockId2: buildLockResourceOptions(CONST.ETCD.LOCK_TYPE.WRITE, undefined, 1),
  lockId3: buildLockResourceOptions(CONST.ETCD.LOCK_TYPE.READ)
};
const LockManagerDummy = {
  getLockResourceOptionsDummy: () => {},
  updateLockResourceDummy: () => {},
  createLockResourceDummy: () => {},
};
const apiServerLockManager = proxyquire('../../eventmesh/ApiServerLockManager', {
  './': {
    'server': {
      'getLockResourceOptions': function (resourceType, resourceName, resourceId) {
        LockManagerDummy.getLockResourceOptionsDummy(resourceType, resourceName, resourceId);
        return Promise.try(() => {
          if (lockoptions[resourceId]) {
            return lockoptions[resourceId];
          }
          if (resourceId === 'lockId4') {
            throw new NotFound('Lock not found');
          } else {
            throw new InternalServerError('Internal Server Error');
          }
        });
      },
      'updateLockResource': function (resourceType, resourceName, resourceId, patchBody) {
        LockManagerDummy.updateLockResourceDummy(resourceType, resourceName, resourceId, patchBody);
        return Promise.resolve({});
      },
      'createLockResource': function (resourceType, resourceName, resourceId, body) {
        LockManagerDummy.createLockResourceDummy(resourceType, resourceName, resourceId, body);
        return Promise.resolve({});
      },
    }
  }
});

describe('eventmesh', () => {
  describe('ApiServerLockManager', () => {
    let getLockResourceOptionsSpy, updateLockResourceSpy, createLockResourceSpy;
    before(function () {
      getLockResourceOptionsSpy = sinon.spy(LockManagerDummy, 'getLockResourceOptionsDummy');
      updateLockResourceSpy = sinon.spy(LockManagerDummy, 'updateLockResourceDummy');
      createLockResourceSpy = sinon.spy(LockManagerDummy, 'createLockResourceDummy');
    });

    afterEach(function () {
      getLockResourceOptionsSpy.reset();
      updateLockResourceSpy.reset();
      createLockResourceSpy.reset();
    });
    describe('#isWriteLocked', () => {
      it('should return true if write lock is present and ttl has not expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId1')
          .then(result => {
            expect(result).to.eql(true);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[2]).to.eql('lockId1');
          });
      });
      it('should return false if write lock is present and ttl has expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId2')
          .then(result => {
            expect(result).to.eql(false);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[2]).to.eql('lockId2');
          });
      });
      it('should return false if non write lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId3')
          .then(result => {
            expect(result).to.eql(false);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[2]).to.eql('lockId3');
          });
      });
      it('should return false if no lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId4')
          .then(result => {
            expect(result).to.eql(false);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[2]).to.eql('lockId4');
          });
      });
      it('should throw an error if api server gives incorrect response', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId5')
          .catch(err => {
            expect(err).to.have.status(500);
            expect(err.description).to.eql('Internal Server Error');
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[2]).to.eql('lockId5');
          });
      });
    });
    describe('#lock', () => {
      it('should return error if lock is present and not expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId1')
          .catch(err => {
            expect(err instanceof ETCDLockError).to.eql(true);
            expect(err.description).to.eql(`Resource lockId1 was locked for backup operation with id guid at ${startTime}`);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[2]).to.eql('lockId1');
          });
      });
      it('should update lock deatails if an expired lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId2')
          .then(() => {
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[2]).to.eql('lockId2');
            expect(updateLockResourceSpy.callCount).to.equal(1);
            expect(updateLockResourceSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(updateLockResourceSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            expect(updateLockResourceSpy.firstCall.args[2]).to.eql('lockId2');
            // TODO Check for arg[3] as well
          });
      });
      it('should create lock if lock is not present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId4')
          .then(() => {
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[2]).to.eql('lockId4');
            expect(createLockResourceSpy.callCount).to.equal(1);
            expect(createLockResourceSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(createLockResourceSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            //TODO check for spy body/patch arguments
          });
      });
      it('should throw an error if api server gives incorrect response', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId5')
          .catch((err) => {
            expect(err).to.have.status(500);
            expect(err.description).to.eql('Internal Server Error');
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.RESOURCE_TYPES.LOCK);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql(CONST.RESOURCE_NAMES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[2]).to.eql('lockId5');
          });
      });
    });
    describe('#unlock', () => {});
  });
});