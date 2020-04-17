'use strict';

const proxyquire = require('proxyquire');
const JSONStream = require('json-stream');
const Promise = require('bluebird');
const _ = require('lodash');
const {
  CONST,
  errors: {
    InternalServerError
  }
} = require('@sf/common-utils');
const { ApiServerClient } = require('@sf/eventmesh');

const CONSTANTS = {
  UNLOCK_RESOURCE_POLLER_INTERVAL: 200,
  APISERVER: {
    RESOURCE_GROUPS: {
      LOCK: 'lock.servicefabrik.io',
      BACKUP: 'backup.servicefabrik.io'
    },
    RESOURCE_TYPES: {
      DEPLOYMENT_LOCKS: 'deploymentlocks',
      DEFAULT_BACKUP: 'defaultbackups'
    },
    RESOURCE_STATE: {
      SUCCEEDED: 'succeeded',
      FAILED: 'failed',
      DELETE_FAILED: 'delete_failed',
      ABORTED: 'aborted',
      UNLOCKED: 'unlocked',
      LOCKED: 'locked'
    },
    WATCHER_REFRESH_INTERVAL: 1200000,
    WATCHER_ERROR_DELAY: 1200000
  }
};
const UnlockResourcePoller = proxyquire('../../data-access-layer/eventmesh/src/UnlockResourcePoller', {
  '@sf/common-utils': {
    CONST: _.defaults({}, CONSTANTS, CONST)
  }
});
UnlockResourcePoller.init();

describe('common', function () {
  describe('UnlockResourcePoller', function () {
    let sandbox, registerWatcherStub;
    before(function () {
      sandbox = sinon.createSandbox();
    });
    after(function () {
      sandbox.restore();
    });

    it('Should start unlock resource poller successfully and register watch', done => {
      const jsonStream = new JSONStream();
      const registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          jsonStream.on('data', callback);
          return jsonStream;
        });
      };
      registerWatcherStub = sandbox.stub(ApiServerClient.prototype, 'registerWatcher').callsFake(registerWatcherFake);
      UnlockResourcePoller.start();
      expect(registerWatcherStub.callCount).to.equal(1);
      expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
      expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
      expect(registerWatcherStub.firstCall.args[2].name).to.eql('startPoller');
      expect(registerWatcherStub.firstCall.args[3]).to.eql(`state notin (${CONST.APISERVER.RESOURCE_STATE.UNLOCKED})`);
      expect(_.size(UnlockResourcePoller.pollers)).to.eql(0);
      registerWatcherStub.resetHistory();
      registerWatcherStub.restore();
      done();
    });

    it('Should finish polling for lock if operation succeeded after receiving event', done => {
      const options = {
        lockTime: new Date(),
        lockedResourceDetails: {
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
          resourceId: 'backup1',
          operation: 'backup'
        }
      };
      const changeObject = {
        type: 'ADDED',
        object: {
          metadata: {
            name: 'lockid1',
            resourceVersion: 10
          },
          spec: {
            options: JSON.stringify(options)
          }
        }
      };
      const payload1 = {
        metadata: {
          resourceVersion: changeObject.object.metadata.resourceVersion
        },
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.UNLOCKED
        }
      };
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, 'backup1', {
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
        }
      });
      mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'lockid1', changeObject.object, 1, payload1);
      const jsonStream = new JSONStream();
      const registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          jsonStream.on('data', callback);
          return jsonStream;
        });
      };
      registerWatcherStub = sandbox.stub(ApiServerClient.prototype, 'registerWatcher').callsFake(registerWatcherFake);
      UnlockResourcePoller.start();
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(registerWatcherStub.callCount).to.equal(1);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('startPoller');
          expect(registerWatcherStub.firstCall.args[3]).to.eql(`state notin (${CONST.APISERVER.RESOURCE_STATE.UNLOCKED})`);
          mocks.verify();
          expect(_.size(UnlockResourcePoller.pollers)).to.eql(0);
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });

    it('Should continue polling for lock if operation not finished after receiving event', done => {
      const options = {
        lockTime: new Date(),
        lockedResourceDetails: {
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
          resourceId: 'backup1',
          operation: 'backup'
        }
      };
      const changeObject = {
        type: 'ADDED',
        object: {
          metadata: {
            name: 'lockid1'
          },
          spec: {
            options: JSON.stringify(options)
          }
        }
      };
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, 'backup1', {
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
        }
      }, 2);
      const jsonStream = new JSONStream();
      const registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          jsonStream.on('data', callback);
          return jsonStream;
        });
      };
      registerWatcherStub = sandbox.stub(ApiServerClient.prototype, 'registerWatcher').callsFake(registerWatcherFake);
      UnlockResourcePoller.start();
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(registerWatcherStub.callCount).to.equal(1);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('startPoller');
          mocks.verify();
          expect(_.size(UnlockResourcePoller.pollers)).to.eql(1);
          UnlockResourcePoller.clearPoller('lockid1', UnlockResourcePoller.pollers.lockid1);
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });

    it('Should clear poller for lock if operation not finished but lock is expired', done => {
      const options = {
        lockTime: new Date(new Date() - 100000000),
        lockedResourceDetails: {
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
          resourceId: 'backup1',
          operation: 'backup'
        }
      };
      const changeObject = {
        type: 'ADDED',
        object: {
          metadata: {
            name: 'lockid1'
          },
          spec: {
            options: JSON.stringify(options)
          }
        }
      };
      const jsonStream = new JSONStream();
      const registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          jsonStream.on('data', callback);
          return jsonStream;
        });
      };
      registerWatcherStub = sandbox.stub(ApiServerClient.prototype, 'registerWatcher').callsFake(registerWatcherFake);
      UnlockResourcePoller.start();
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(registerWatcherStub.callCount).to.equal(1);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('startPoller');
          mocks.verify();
          expect(_.size(UnlockResourcePoller.pollers)).to.eql(0);
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });

    it('Should finish polling for lock if operation resource is not found after receiving event', done => {
      const options = {
        lockTime: new Date(),
        lockedResourceDetails: {
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
          resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
          resourceId: 'backup1',
          operation: 'backup'
        }
      };
      const changeObject = {
        type: 'ADDED',
        object: {
          metadata: {
            name: 'lockid1',
            resourceVersion: 10
          },
          spec: {
            options: JSON.stringify(options)
          }
        }
      };
      const payload1 = {
        metadata: {
          resourceVersion: changeObject.object.metadata.resourceVersion
        },
        status: {
          state: CONST.APISERVER.RESOURCE_STATE.UNLOCKED
        }
      };
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, 'backup1', {}, 1, 404);
      mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.LOCK, CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, 'lockid1', changeObject.object, 1, payload1);
      const jsonStream = new JSONStream();
      const registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          jsonStream.on('data', callback);
          return jsonStream;
        });
      };
      registerWatcherStub = sandbox.stub(ApiServerClient.prototype, 'registerWatcher').callsFake(registerWatcherFake);
      UnlockResourcePoller.start();
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(500).then(() => {
          expect(registerWatcherStub.callCount).to.equal(1);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('startPoller');
          mocks.verify();
          expect(_.size(UnlockResourcePoller.pollers)).to.eql(0);
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });

    it('Should retry register watch in case of error', done => {
      const NEWCONST = {
        APISERVER: {
          RESOURCE_GROUPS: {
            LOCK: 'lock.servicefabrik.io'
          },
          RESOURCE_TYPES: {
            DEPLOYMENT_LOCKS: 'deploymentlocks'
          },
          RESOURCE_STATE: {
            UNLOCKED: 'unlocked'
          },
          WATCHER_REFRESH_INTERVAL: 1200000,
          WATCHER_ERROR_DELAY: 300
        }
      };
      const UnlockResourcePollerNew = proxyquire('../../data-access-layer/eventmesh/src/UnlockResourcePoller', {
        '@sf/common-utils': {
          CONST: NEWCONST
        }
      });

      const jsonStream = new JSONStream();
      let i = 0;
      const registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          i++;
          if (i === 2) {
            jsonStream.on('data', callback);
            return jsonStream;
          } else {
            throw new InternalServerError('Internal Server Error');
          }
        });
      };
      registerWatcherStub = sandbox.stub(ApiServerClient.prototype, 'registerWatcher').callsFake(registerWatcherFake);
      UnlockResourcePollerNew.start();
      return Promise.delay(700)
        .then(() => {
          expect(registerWatcherStub.callCount).to.equal(2);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.LOCK);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('startPoller');
          expect(_.size(UnlockResourcePoller.pollers)).to.eql(0);
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });
  });
});
