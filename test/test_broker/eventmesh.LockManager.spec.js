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
    spec: {
      options: lockoptions.lockId1
    }
  },
  conflictresource: {
    spec: {
      options: lockoptions.lockId2
    }
  },
  lockId2: {
    spec: {
      options: lockoptions.lockId2
    }
  },
  lockId3: {
    spec: {
      options: lockoptions.lockId3
    }
  }
};

const LockManagerDummy = {
  updateResourceDummy: () => {},
  createResourceDummy: () => {},
  getResourceDummy: () => {},
};
const apiServerLockManager = proxyquire('../../data-access-layer/eventmesh/LockManager', {
  './': {
    'apiServerClient': {
      'updateResource': function (opts) {
        LockManagerDummy.updateResourceDummy(opts);
        if (opts.resourceId === 'conflictresource') {
          throw new Conflict('Conflict');
        }
        return Promise.resolve({});
      },
      'createResource': function (opts) {
        LockManagerDummy.createResourceDummy(opts);
        return Promise.resolve({});
      },
      'getResource': function (opts) {
        LockManagerDummy.getResourceDummy(opts);
        return Promise.try(() => {
          if (lock[opts.resourceId]) {
            return lock[opts.resourceId];
          }
          if (opts.resourceId === 'lockId4') {
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
    let updateResourceSpy, createResourceSpy, getResourceSpy;
    before(function () {
      updateResourceSpy = sinon.spy(LockManagerDummy, 'updateResourceDummy');
      createResourceSpy = sinon.spy(LockManagerDummy, 'createResourceDummy');
      getResourceSpy = sinon.spy(LockManagerDummy, 'getResourceDummy');
    });

    afterEach(function () {
      updateResourceSpy.reset();
      createResourceSpy.reset();
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
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'lockId1'
            });
          });
      });
      it('should return false if write lock is present and ttl has expired', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.checkWriteLockStatus('lockId2')
          .then(result => {
            expect(result.isWriteLocked).to.eql(false);
            expect(result.lockDetails).to.eql(undefined);
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'lockId2'
            });
          });
      });
      it('should return false if non write lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.checkWriteLockStatus('lockId3')
          .then(result => {
            expect(result.isWriteLocked).to.eql(false);
            expect(result.lockDetails).to.eql(undefined);
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'lockId3'
            });
          });
      });
      it('should return false if no lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.checkWriteLockStatus('lockId4')
          .then(result => {
            expect(result.isWriteLocked).to.eql(false);
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'lockId4'
            });
          });
      });
      it('should throw an error if api server gives incorrect response', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.checkWriteLockStatus('lockId5')
          .catch(err => {
            expect(err).to.have.status(500);
            expect(err.description).to.eql('Internal Server Error');
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'lockId5'
            });
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
            expect(getResourceSpy.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'lockId1'
            });
          });
      });
      it('should update lock deatails if an expired lock is present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId2', lockoptions.lockId2)
          .then(() => {
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'lockId2'
            });
            expect(updateResourceSpy.callCount).to.equal(1);
            expect(updateResourceSpy.firstCall.args[0].resourceGroup).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
            expect(updateResourceSpy.firstCall.args[0].resourceType).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(updateResourceSpy.firstCall.args[0].resourceId).to.eql('lockId2');
            expect(updateResourceSpy.firstCall.args[0].options.lockType).to.eql('READ');
          });
      });
      it('should create lock if lock is not present', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId4', lockoptions.lockId1)
          .then(() => {
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'lockId4'
            });
            expect(createResourceSpy.callCount).to.equal(1);
            expect(createResourceSpy.firstCall.args[0].resourceGroup).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
            expect(createResourceSpy.firstCall.args[0].resourceType).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
            expect(createResourceSpy.firstCall.args[0].resourceId).to.eql('lockId4');
            expect(createResourceSpy.firstCall.args[0].options.lockType).to.eql('READ');
          });
      });
      it('should throw an error if api server gives incorrect response', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('lockId5', lockoptions.lockId1)
          .catch((err) => {
            expect(err).to.have.status(500);
            expect(err.description).to.eql('Internal Server Error');
            expect(getResourceSpy.callCount).to.equal(1);
            expect(getResourceSpy.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'lockId5'
            });
          });
      });
      it('should throw a conflict error if api server gives incorrect response', () => {
        const lockManager = new apiServerLockManager();
        return lockManager.lock('conflictresource', lockoptions.conflictresource)
          .catch((err) => {
            expect(err).to.have.status(422);
            expect(err.description).to.eql(`Service Instance conflictresource __Locked__ at ${startTime} for backup`);
            expect(getResourceSpy.callCount).to.equal(2);
            expect(getResourceSpy.firstCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'conflictresource'
            });
            expect(getResourceSpy.secondCall.args[0]).to.eql({
              resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.LOCK,
              resourceType: CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS,
              resourceId: 'conflictresource'
            });
          });
      });
    });
    describe('#unlock', () => {});
  });
});