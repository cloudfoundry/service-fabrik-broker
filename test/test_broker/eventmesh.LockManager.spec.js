'use strict';

const Promise = require('bluebird');
// const lockManager = require('../../eventmesh').lockManager;
const CONST = require('../../common/constants');
const proxyquire = require('proxyquire');
const errors = require('../../common/errors');
const NotFound = errors.NotFound;
const InternalServerError = errors.InternalServerError;
const DeploymentAlreadyLocked = errors.DeploymentAlreadyLocked;
// const resourceType = 'lock';
// const resourceName = 'deploymentlocks';

const startTime = new Date();

function buildLockResourceOptions(lockType, lockTime, lockTTL) {
  return JSON.stringify({
    lockType: lockType,
    lockTime: lockTime ? lockTime : startTime,
    lockTTL: lockTTL ? lockTTL : Infinity,
    lockedResourceDetails: {
      resourceGroup: 'backup',
      resourceType: 'defaultbackup',
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
const lock = {
  lockId1: {
    body: {
      spec: {
        options: lockoptions.lockId1
      }
    }
  },
  lockId2: {
    body: {
      spec: {
        options: lockoptions.lockId2
      }
    }
  },
  lockId3: {
    body: {
      spec: {
        options: lockoptions.lockId3
      }
    }
  }
};
const LockManagerDummy = {
  getLockResourceOptionsDummy: () => {},
  updateResourceDummy: () => {},
  createLockResourceDummy: () => {},
  getResourceDummy: () => {},
};
const apiServerLockManager = proxyquire('../../eventmesh/LockManager', {
  './': {
    'apiServerClient': {
      'getLockDetails': function (resourceName, resourceId) {
        LockManagerDummy.getLockResourceOptionsDummy(resourceName, resourceId);
        return Promise.try(() => {
          if (lockoptions[resourceId]) {
            return JSON.parse(lockoptions[resourceId]);
          }
          if (resourceId === 'lockId4') {
            throw new NotFound('Lock not found');
          } else {
            throw new InternalServerError('Internal Server Error');
          }
        });
      },
      'updateResource': function (resourceType, resourceName, resourceId, patchBody) {
        LockManagerDummy.updateResourceDummy(resourceType, resourceName, resourceId, patchBody);
        return Promise.resolve({});
      },
      'createLock': function (resourceName, body) {
        LockManagerDummy.createLockResourceDummy(resourceName, body);
        return Promise.resolve({});
      },
      'getResource': function (resourceType, resourceName, resourceId) {
        LockManagerDummy.getResourceDummy(resourceType, resourceName, resourceId);
        return Promise.try(() => {
          if (lock[resourceId]) {
            return lock[resourceId];
          }
          if (resourceId === 'lockId4') {
            throw new NotFound('Lock not found');
          } else {
            throw new InternalServerError('Internal Server Error');
          }
        });
      },
    }
  }
});

describe('eventmesh', () => {
  describe('LockManager', () => {
    let getLockResourceOptionsSpy, updateResourceSpy, createLockResourceSpy, getResourceSpy;
    before(function () {
      getLockResourceOptionsSpy = sinon.spy(LockManagerDummy, 'getLockResourceOptionsDummy');
      updateResourceSpy = sinon.spy(LockManagerDummy, 'updateResourceDummy');
      createLockResourceSpy = sinon.spy(LockManagerDummy, 'createLockResourceDummy');
      getResourceSpy = sinon.spy(LockManagerDummy, 'getResourceDummy');
    });

    afterEach(function () {
      getLockResourceOptionsSpy.reset();
      updateResourceSpy.reset();
      createLockResourceSpy.reset();
      getResourceSpy.reset();
    });
    describe('#isWriteLocked', () => {
      it('should return true if write lock is present and ttl has not expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId1')
          .then(result => {
            expect(result).to.eql(true);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql('lockId1');
          });
      });
      it('should return false if write lock is present and ttl has expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId2')
          .then(result => {
            expect(result).to.eql(false);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql('lockId2');
          });
      });
      it('should return false if non write lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId3')
          .then(result => {
            expect(result).to.eql(false);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql('lockId3');
          });
      });
      it('should return false if no lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId4')
          .then(result => {
            expect(result).to.eql(false);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql('lockId4');
          });
      });
      it('should throw an error if api server gives incorrect response', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.isWriteLocked('lockId5')
          .catch(err => {
            expect(err).to.have.status(500);
            expect(err.description).to.eql('Internal Server Error');
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql('lockId5');
          });
      });
    });
    describe('#lock', () => {
      it('should return error if lock is present and not expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId1')
          .catch(err => {
            expect(err instanceof DeploymentAlreadyLocked).to.eql(true);
            expect(err.description).to.eql(`Service Instance lockId1 __Locked__ at ${startTime} for backup`);
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
            expect(getResourceSpy.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getResourceSpy.firstCall.args[2]).to.eql('lockId1');
          });
      });
      it('should update lock deatails if an expired lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId2')
          .then(() => {
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
            expect(getResourceSpy.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getResourceSpy.firstCall.args[2]).to.eql('lockId2');
            expect(updateResourceSpy.callCount).to.equal(1);
            expect(updateResourceSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
            expect(updateResourceSpy.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(updateResourceSpy.firstCall.args[2]).to.eql('lockId2');
            // TODO Check for arg[3] as well
          });
      });
      it('should create lock if lock is not present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId4')
          .then(() => {
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
            expect(getResourceSpy.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getResourceSpy.firstCall.args[2]).to.eql('lockId4');
            expect(createLockResourceSpy.callCount).to.equal(1);
            expect(createLockResourceSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            //TODO check for spy body/patch arguments
          });
      });
      it('should throw an error if api server gives incorrect response', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId5')
          .catch((err) => {
            expect(err).to.have.status(500);
            expect(err.description).to.eql('Internal Server Error');
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
            expect(getResourceSpy.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getResourceSpy.firstCall.args[2]).to.eql('lockId5');
          });
      });
    });
    describe('#unlock', () => {});
  });
});