'use strict';

const Promise = require('bluebird');
const CONST = require('../../common/constants');
const proxyquire = require('proxyquire');
const errors = require('../../common/errors');
const NotFound = errors.NotFound;
const InternalServerError = errors.InternalServerError;
const Conflict = errors.Conflict;
const DeploymentAlreadyLocked = errors.DeploymentAlreadyLocked;
// const resourceType = 'lock';
// const resourceName = 'deploymentlocks';

const startTime = new Date();

function buildLockResourceOptions(lockType, lockTime, lockTTL) {
  return {
    lockType: lockType,
    lockTime: lockTime ? lockTime : startTime,
    lockTTL: lockTTL ? lockTTL : Infinity,
    lockedResourceDetails: {
      resourceGroup: 'backup',
      resourceType: 'defaultbackup',
      resourceId: 'guid',
      operation: 'backup'
    }
  };
}
const lockoptions = {
  lockId1: buildLockResourceOptions(CONST.ETCD.LOCK_TYPE.WRITE),
  lockId2: buildLockResourceOptions(CONST.ETCD.LOCK_TYPE.WRITE, undefined, 1),
  lockId3: buildLockResourceOptions(CONST.ETCD.LOCK_TYPE.READ),
  conflictresource: buildLockResourceOptions(CONST.ETCD.LOCK_TYPE.WRITE)
};
const lock = {
  lockId1: {
    body: {
      spec: {
        options: JSON.stringify(lockoptions.lockId1)
      }
    }
  },
  conflictresource: {
    body: {
      spec: {
        options: JSON.stringify(lockoptions.lockId2)
      }
    }
  },
  lockId2: {
    body: {
      spec: {
        options: JSON.stringify(lockoptions.lockId2)
      }
    }
  },
  lockId3: {
    body: {
      spec: {
        options: JSON.stringify(lockoptions.lockId3)
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
const apiServerLockManager = proxyquire('../../data-access-layer/eventmesh/LockManager', {
  './': {
    'apiServerClient': {
      'getLockDetails': function (resourceName, resourceId) {
        LockManagerDummy.getLockResourceOptionsDummy(resourceName, resourceId);
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
      'updateResource': function (resourceType, resourceName, resourceId, patchBody) {
        LockManagerDummy.updateResourceDummy(resourceType, resourceName, resourceId, patchBody);
        if (resourceId === 'conflictresource') {
          throw new Conflict('Conflict');
        }
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
    describe('#checkWriteLockStatus', () => {
      it('should return true if write lock is present and ttl has not expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.checkWriteLockStatus('lockId1')
          .then(result => {
            expect(result.isWriteLocked).to.eql(true);
            expect(result.lockDetails.lockType).to.eql('WRITE');
            expect(result.lockDetails.lockedResourceDetails).to.eql(lockoptions.lockId1.lockedResourceDetails);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql('lockId1');
          });
      });
      it('should return false if write lock is present and ttl has expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.checkWriteLockStatus('lockId2')
          .then(result => {
            expect(result.isWriteLocked).to.eql(false);
            expect(result.lockDetails).to.eql(undefined);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql('lockId2');
          });
      });
      it('should return false if non write lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.checkWriteLockStatus('lockId3')
          .then(result => {
            expect(result.isWriteLocked).to.eql(false);
            expect(result.lockDetails).to.eql(undefined);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql('lockId3');
          });
      });
      it('should return false if no lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.checkWriteLockStatus('lockId4')
          .then(result => {
            expect(result.isWriteLocked).to.eql(false);
            expect(getLockResourceOptionsSpy.callCount).to.equal(1);
            expect(getLockResourceOptionsSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getLockResourceOptionsSpy.firstCall.args[1]).to.eql('lockId4');
          });
      });
      it('should throw an error if api server gives incorrect response', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.checkWriteLockStatus('lockId5')
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
        return lockManager.lock('lockId1', lockoptions.lockId1)
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
        return lockManager.lock('lockId2', lockoptions.lockId2)
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
        return lockManager.lock('lockId4', lockoptions.lockId1)
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
        return lockManager.lock('lockId5', lockoptions.lockId1)
          .catch((err) => {
            expect(err).to.have.status(500);
            expect(err.description).to.eql('Internal Server Error');
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
            expect(getResourceSpy.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getResourceSpy.firstCall.args[2]).to.eql('lockId5');
          });
      });
      it('should throw a conflict error if api server gives incorrect response', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('conflictresource', lockoptions.conflictresource)
          .catch((err) => {
            expect(err).to.have.status(422);
            expect(err.description).to.eql(`Service Instance conflictresource __Locked__ at ${startTime} for backup`);
            expect(getResourceSpy.callCount).to.equal(2);
            expect(getResourceSpy.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
            expect(getResourceSpy.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(getResourceSpy.firstCall.args[2]).to.eql('conflictresource');
          });
      });
    });
    describe('#unlock', () => {});
  });
});