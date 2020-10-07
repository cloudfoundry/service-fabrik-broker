'use strict';

const _ = require('lodash');
const {
  CONST,
  errors: {
    DeploymentAlreadyLocked
  }
} = require('@sf/common-utils');
const { lockManager } = require('@sf/eventmesh');

const samplelock1 = {
  spec: {
    options: JSON.stringify({
      lockTime: new Date(),
      lockType: CONST.APISERVER.LOCK_TYPE.WRITE,
      lockedResourceDetails: {
        operation: 'create'
      }
    })
  },
  status: {}
};
const samplelock2 = {
  spec: {
    options: JSON.stringify({
      lockTime: new Date(),
      lockType: CONST.APISERVER.LOCK_TYPE.WRITE,
      lockedResourceDetails: {
        operation: 'create'
      }
    })
  },
  status: {
    state: CONST.APISERVER.RESOURCE_STATE.LOCKED
  }
};
const samplelock3 = {
  metadata: {
    name: 'samplelock3',
    resourceVersion: '3',
    labels: {
      state: CONST.APISERVER.RESOURCE_STATE.UNLOCKED
    }
  },
  spec: {
    options: JSON.stringify({
      lockTime: new Date(),
      lockType: CONST.APISERVER.LOCK_TYPE.WRITE,
      lockTTL: 86400000,
      lockedResourceDetails: {
        operation: 'create'
      }
    })
  },
  status: {
    state: CONST.APISERVER.RESOURCE_STATE.UNLOCKED
  }
};
const samplelock4 = {
  metadata: {
    name: 'samplelock4',
    resourceVersion: '2'
  },
  spec: {
    options: JSON.stringify({
      lockTime: new Date(new Date() - 10000000000),
      lockType: CONST.APISERVER.LOCK_TYPE.WRITE,
      lockTTL: 86400000,
      lockedResourceDetails: {
        operation: 'create'
      }
    })
  },
  status: {
    state: CONST.APISERVER.RESOURCE_STATE.LOCKED
  }
};
const samplelock5 = {
  spec: {
    options: JSON.stringify({
      lockTime: new Date(),
      lockType: CONST.APISERVER.LOCK_TYPE.READ,
      lockedResourceDetails: {
        operation: 'create'
      }
    })
  },
  status: {
    state: CONST.APISERVER.RESOURCE_STATE.LOCKED
  }
};

const samplelock6 = {
  apiVersion: 'lock.servicefabrik.io/v1alpha1',
  kind: 'DeploymentLock',
  metadata: {
    name: 'samplelock6',
    labels: {
      state: CONST.APISERVER.RESOURCE_STATE.LOCKED
    }
  },
  spec: {
    options: JSON.stringify({
      lockTime: new Date(),
      lockTTL: 86400000,
      lockType: CONST.APISERVER.LOCK_TYPE.WRITE,
      lockedResourceDetails: {
        operation: 'create'
      }
    })
  },
  status: {
    state: CONST.APISERVER.RESOURCE_STATE.LOCKED
  }
};

describe('eventmesh', () => {
  describe('LockManager', () => {
    describe('#checkWriteLockStatus', () => {
      it('should return true if write lock is present and state is undefined and ttl has not expired', () => {
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock1', samplelock1);
        return lockManager.checkWriteLockStatus('samplelock1')
          .then(result => {
            mocks.verify();
            expect(result.isWriteLocked).to.eql(true);
            expect(result.lockDetails.lockType).to.eql('WRITE');
            expect(result.lockDetails.lockedResourceDetails).to.eql(JSON.parse(samplelock1.spec.options).lockedResourceDetails);
          });
      });
      it('should return true if write lock is present and state is locked and ttl has not expired', () => {
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock2', samplelock2);
        return lockManager.checkWriteLockStatus('samplelock2')
          .then(result => {
            mocks.verify();
            expect(result.isWriteLocked).to.eql(true);
            expect(result.lockDetails.lockType).to.eql('WRITE');
            expect(result.lockDetails.lockedResourceDetails).to.eql(JSON.parse(samplelock2.spec.options).lockedResourceDetails);
          });
      });
      it('should return false if state is unlocked', () => {
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock3', samplelock3);
        return lockManager.checkWriteLockStatus('samplelock3')
          .then(result => {
            mocks.verify();
            expect(result.isWriteLocked).to.eql(false);
            expect(result.lockDetails).to.eql(undefined);
          });
      });
      it('should return false if write lock is present and ttl has expired', () => {
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock4', samplelock4);
        return lockManager.checkWriteLockStatus('samplelock4')
          .then(result => {
            mocks.verify();
            expect(result.isWriteLocked).to.eql(false);
            expect(result.lockDetails).to.eql(undefined);
          });
      });
      it('should return false if non write lock is present', () => {
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock5', samplelock5);
        return lockManager.checkWriteLockStatus('samplelock5')
          .then(result => {
            mocks.verify();
            expect(result.isWriteLocked).to.eql(false);
            expect(result.lockDetails).to.eql(undefined);
          });
      });
      it('should return false if no lock is present', () => {
        return lockManager.checkWriteLockStatus('sample')
          .then(result => {
            mocks.verify();
            expect(result.isWriteLocked).to.eql(false);
            expect(result.lockDetails).to.eql(undefined);
          });
      });
      it('should throw an error if api server gives incorrect response', () => {
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock2', {}, 1, 500);
        return lockManager.checkWriteLockStatus('samplelock2')
          .catch(err => {
            expect(err).to.have.status(500);
            expect(err.reason).to.eql('Internal Server Error');
          });
      });
    });

    describe('#lock', () => {
      it('should return error if lock state is locked and not expired', () => {
        const lockOptions = JSON.parse(samplelock2.spec.options);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock2', samplelock2);
        return lockManager.lock('samplelock2', lockOptions)
          .catch(err => {
            mocks.verify();
            expect(err instanceof DeploymentAlreadyLocked).to.eql(true);
            expect(err.description).to.eql(`Service Instance samplelock2 __Locked__ at ${new Date(lockOptions.lockTime)} for create`);
          });
      });
      it('should return error if lock state is undefined and not expired', () => {
        const lockOptions = JSON.parse(samplelock1.spec.options);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock1', samplelock1);
        return lockManager.lock('samplelock1', lockOptions)
          .catch(err => {
            mocks.verify();
            expect(err instanceof DeploymentAlreadyLocked).to.eql(true);
            expect(err.description).to.eql(`Service Instance samplelock1 __Locked__ at ${new Date(lockOptions.lockTime)} for create`);
          });
      });
      it('should update lock details if an expired lock is present', () => {
        const lockOptions = JSON.parse(samplelock4.spec.options);
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock4', samplelock4);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock4', samplelock4, 1, samplelock4);
        return lockManager.lock('samplelock4', lockOptions)
          .then(res => {
            mocks.verify();
            expect(res).to.eql(samplelock4.metadata.resourceVersion);
          });
      });
      it('should update lock details if lock state is unlocked', () => {
        const lockOptions = JSON.parse(samplelock3.spec.options);
        const payload = _.cloneDeep(samplelock3);
        payload.metadata.labels.state = CONST.APISERVER.RESOURCE_STATE.LOCKED;
        payload.status.state = CONST.APISERVER.RESOURCE_STATE.LOCKED;
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock3', samplelock3);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock3', payload, 1, payload);
        return lockManager.lock('samplelock3', lockOptions)
          .then(res => {
            mocks.verify();
            expect(res).to.eql(samplelock3.metadata.resourceVersion);
          });
      });
      it('should create lock if lock is not present', () => {
        const lockOptions = JSON.parse(samplelock6.spec.options);
        mocks.apiServerEventMesh.nockCreateResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, samplelock6, 1, samplelock6);
        return lockManager.lock('samplelock6', lockOptions)
          .then(res => {
            mocks.verify();
            expect(res).to.eql(samplelock6.metadata.resourceVersion);
          });
      });
      it('should throw an error if api server gives incorrect response', () => {
        const lockOptions = JSON.parse(samplelock6.spec.options);
        return lockManager.lock('samplelock6', lockOptions)
          .catch(err => {
            expect(err).to.have.status(404);
            expect(err.reason).to.eql('Not Found');
          });
      });
      it('should throw a conflict error if api server gives incorrect response', () => {
        const lockOptions = JSON.parse(samplelock3.spec.options);
        const payload1 = _.cloneDeep(samplelock3);
        payload1.metadata.labels.state = CONST.APISERVER.RESOURCE_STATE.LOCKED;
        payload1.status.state = CONST.APISERVER.RESOURCE_STATE.LOCKED;
        mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock3', samplelock3, 2);
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock3', samplelock3, 1, payload1, 409);
        return lockManager.lock('samplelock3', lockOptions)
          .catch(err => {
            mocks.verify();
            expect(err).to.have.status(422);
            expect(err.description).to.eql(`Service Instance samplelock3 __Locked__ at ${new Date(lockOptions.lockTime)} for create`);
          });
      });
    });

    describe('#unlock', () => {
      let sandbox, delayStub;
      before(function () {
        sandbox = sinon.createSandbox();
        delayStub = sandbox.stub(Promise, 'delay').callsFake(() => Promise.resolve(true));
      });

      after(function () {
        delayStub.restore();
      });
      it('should successfully unlock resource in first try without lockId', () => {
        const payload2 = {
          metadata: {
            labels: {
              state: CONST.APISERVER.RESOURCE_STATE.UNLOCKED
            }
          },
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.UNLOCKED
          }
        };
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock6', samplelock6, 1, payload2);
        return lockManager.unlock('samplelock6')
          .then(() => {
            mocks.verify();
          });
      });
      it('should successfully unlock resource in first try given lockId', () => {
        const payload1 = {
          metadata: {
            labels: {
              state: CONST.APISERVER.RESOURCE_STATE.UNLOCKED
            }
          },
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.UNLOCKED
          }
        };
        const lockId = samplelock4.metadata.resourceVersion;
        if (lockId) {
          // update payload, if lockId is available
          payload1.metadata.resourceVersion = lockId;
        }
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock4', samplelock4, 1, payload1);
        return lockManager.unlock('samplelock4', lockId)
          .then(() => {
            mocks.verify();
          });
      });
      it('should successfully unlock resource in first try if lock is not found', () => {
        const payload1 = {};
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock6', samplelock6, 1, payload1, 404);
        return lockManager.unlock('samplelock6', samplelock6.metadata.resourceVersion)
          .then(() => {
            mocks.verify();
          });
      });
      it('should successfully unlock resource in first try if apiserver returns conflict', () => {
        const payload1 = {};
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock6', samplelock6, 1, payload1, 409);
        return lockManager.unlock('samplelock6', samplelock6.metadata.resourceVersion)
          .then(() => {
            mocks.verify();
          });
      });
      it('should fail to unlock resource after multiple retries', () => {
        const payload1 = {
          metadata: {
            resourceVersion: samplelock6.metadata.resourceVersion
          }
        };
        mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'samplelock6', samplelock6, 3, payload1, 500);
        return lockManager.unlock('samplelock6', samplelock6.metadata.resourceVersion, 3, 100)
          .catch(err => {
            mocks.verify();
            expect(err.code).to.eql('ETIMEDOUT');
            expect(err.error.status).to.eql(500);
            expect(err.error.description).to.eql('Could not unlock resource samplelock6 even after 3 retries');
          });
      });
    });
  });
});
