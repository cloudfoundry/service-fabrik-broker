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
  POLLER_RELAXATION_TIME: 1000000,
  APISERVER: {
    RESOURCE_GROUPS: {
      BACKUP: 'backup.servicefabrik.io'
    },
    RESOURCE_TYPES: {
      DEFAULT_BACKUP: 'defaultbackups'
    },
    RESOURCE_STATE: {
      IN_PROGRESS: 'in_progress'
    },
    WATCH_EVENT: {
      ADDDED: 'ADDED'
    },
    POLLER_WATCHER_REFRESH_INTERVAL: 120000,
    WATCHER_ERROR_DELAY: 1200000
  }
};

const BaseStatusPoller = proxyquire('../src/BaseStatusPoller', {
  '@sf/common-utils': {
    CONST: CONSTANTS
  }
});

describe('operators', function () {
  describe('BaseStatusPoller', function () {

    let sandbox, registerWatcherStub;
    before(function () {
      sandbox = sinon.createSandbox();
    });
    after(function () {
      sandbox.restore();
    });

    it('Should start status poller successfully and register watch', done => {
      const jsonStream = new JSONStream();
      const registerWatcherFake = function (resourceGroup, resourceType, callback) {
        return Promise.try(() => {
          jsonStream.on('data', callback);
          return jsonStream;
        });
      };
      registerWatcherStub = sandbox.stub(ApiServerClient.prototype, 'registerWatcher').callsFake(registerWatcherFake);
      const baseStatusPoller = new BaseStatusPoller({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        validStateList: [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS],
        validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED],
        pollInterval: 10000
      });
      expect(registerWatcherStub.callCount).to.equal(1);
      expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.BACKUP);
      expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP);
      expect(registerWatcherStub.firstCall.args[2].name).to.eql('bound startPoller');
      expect(registerWatcherStub.firstCall.args[3]).to.eql(`state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS})`);
      expect(_.size(baseStatusPoller.pollers)).to.eql(0);
      registerWatcherStub.resetHistory();
      registerWatcherStub.restore();
      done();
    });

    it('Should retry register watch in case of error', done => {
      const NEWCONST = {
        APISERVER: {
          RESOURCE_GROUPS: {
            BACKUP: 'backup.servicefabrik.io'
          },
          RESOURCE_TYPES: {
            DEFAULT_BACKUP: 'defaultbackups'
          },
          RESOURCE_STATE: {
            IN_PROGRESS: 'in_progress'
          },
          WATCH_EVENT: {
            ADDDED: 'ADDED'
          },
          POLLER_WATCHER_REFRESH_INTERVAL: 1200000,
          WATCHER_ERROR_DELAY: 10
        }
      };
      const BaseStatusPollerNew = proxyquire('../src/BaseStatusPoller', {
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
      const baseStatusPoller = new BaseStatusPollerNew({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        validStateList: [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS],
        validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED],
        pollInterval: 100000
      });
      return Promise.delay(30)
        .then(() => {
          expect(registerWatcherStub.callCount).to.equal(2);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.BACKUP);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('bound startPoller');
          expect(registerWatcherStub.firstCall.args[3]).to.eql(`state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS})`);
          expect(_.size(baseStatusPoller.pollers)).to.eql(0);
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });


    it('Should start poller with given poll interval after receiving event', done => {
      const changeObject = {
        type: 'ADDED',
        object: {
          metadata: {
            name: 'guid',
            resourceVersion: 10
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
      const baseStatusPoller = new BaseStatusPoller({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        validStateList: [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS],
        validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED],
        pollInterval: 10000
      });
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .then(() => {
          expect(registerWatcherStub.callCount).to.equal(1);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.BACKUP);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('bound startPoller');
          expect(registerWatcherStub.firstCall.args[3]).to.eql(`state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS})`);
          expect(_.size(baseStatusPoller.pollers)).to.eql(1);
          clearInterval(baseStatusPoller.pollers.guid);
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });

    it('Should not start poller if poller is already running', done => {
      const changeObject = {
        type: 'ADDED',
        object: {
          metadata: {
            name: 'guid',
            resourceVersion: 10
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
      const baseStatusPoller = new BaseStatusPoller({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        validStateList: [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS],
        validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED],
        pollInterval: 10000
      });
      baseStatusPoller.pollers.guid = {};
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .then(() => {
          expect(registerWatcherStub.callCount).to.equal(1);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.BACKUP);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('bound startPoller');
          expect(registerWatcherStub.firstCall.args[3]).to.eql(`state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS})`);
          expect(_.size(baseStatusPoller.pollers)).to.eql(1);
          clearInterval(baseStatusPoller.pollers.guid);
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });


    it('Should not get polling lock if lock is already present', done => {
      const changeObject = {
        type: 'ADDED',
        object: {
          metadata: {
            name: 'guid',
            selfLink: '/apis/backup.servicefabrik.io/v1alpha1/namespaces/default/defaultbackups/guid',
            resourceVersion: 10,
            labels: {
              state: 'in_progress'
            }
          },
          status: {
            state: 'in_progress'
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
      const baseStatusPoller = new BaseStatusPoller({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        validStateList: [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS],
        validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED],
        pollInterval: 100
      });
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, 'guid', {
        metadata: {
          name: 'guid',
          selfLink: '/apis/backup.servicefabrik.io/v1alpha1/namespaces/default/defaultbackups/guid',
          resourceVersion: 10,
          annotations: {
            lockedByTaskPoller: JSON.stringify({
              lockTime: new Date(),
              ip: '10.0.2.3'
            })
          },
          labels: {
            state: 'succeeded'
          }
        },
        spec: {
          options: ''
        },
        status: {
          state: 'succeeded'
        }
      });
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(150).then(() => {
          expect(registerWatcherStub.callCount).to.equal(1);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.BACKUP);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('bound startPoller');
          expect(registerWatcherStub.firstCall.args[3]).to.eql(`state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS})`);
          expect(_.size(baseStatusPoller.pollers)).to.eql(1);
          clearInterval(baseStatusPoller.pollers.guid);
          mocks.verify();
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });

    it('Should continue polling if not able to acquire lock', done => {
      const changeObject = {
        type: 'ADDED',
        object: {
          metadata: {
            name: 'guid1',
            selfLink: '/apis/backup.servicefabrik.io/v1alpha1/namespaces/default/defaultbackups/guid',
            resourceVersion: 10,
            labels: {
              state: 'in_progress'
            }
          },
          status: {
            state: 'in_progress'
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
      const baseStatusPoller = new BaseStatusPoller({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        validStateList: [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS],
        validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED],
        pollInterval: 100
      });
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, 'guid1', {
        metadata: {
          name: 'guid1',
          selfLink: '/apis/backup.servicefabrik.io/v1alpha1/namespaces/default/defaultbackups/guid1',
          resourceVersion: 10,
          labels: {
            state: 'in_progress'
          }
        },
        spec: {
          options: ''
        },
        status: {
          state: 'in_progress'
        }
      });
      mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, 'guid1', {}, 1, undefined, 409);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(200).then(() => {
          expect(registerWatcherStub.callCount).to.equal(1);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.BACKUP);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('bound startPoller');
          expect(registerWatcherStub.firstCall.args[3]).to.eql(`state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS})`);
          expect(_.size(baseStatusPoller.pollers)).to.eql(1);
          clearInterval(baseStatusPoller.pollers.guid1);
          mocks.verify();
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });

    it('Should clear poller in case of error', done => {
      const changeObject = {
        type: 'ADDED',
        object: {
          metadata: {
            name: 'guid',
            selfLink: '/apis/backup.servicefabrik.io/v1alpha1/namespaces/default/defaultbackups/guid',
            resourceVersion: 10,
            labels: {
              state: 'in_progress'
            }
          },
          status: {
            state: 'in_progress'
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
      const baseStatusPoller = new BaseStatusPoller({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.BACKUP,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP,
        validStateList: [CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS],
        validEventList: [CONST.API_SERVER.WATCH_EVENT.ADDED],
        pollInterval: 100
      });
      mocks.apiServerEventMesh.nockGetResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, 'guid', {
        metadata: {
          name: 'guid',
          selfLink: '/apis/backup.servicefabrik.io/v1alpha1/namespaces/default/defaultbackups/guid',
          resourceVersion: 10,
          labels: {
            state: 'in_progress'
          }
        },
        spec: {
          options: ''
        },
        status: {
          state: 'in_progress'
        }
      });
      mocks.apiServerEventMesh.nockPatchResource(CONST.APISERVER.RESOURCE_GROUPS.BACKUP, CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP, 'guid', {}, 1);
      return Promise.try(() => jsonStream.write(JSON.stringify(changeObject)))
        .delay(150).then(() => {
          expect(registerWatcherStub.callCount).to.equal(1);
          expect(registerWatcherStub.firstCall.args[0]).to.eql(CONST.APISERVER.RESOURCE_GROUPS.BACKUP);
          expect(registerWatcherStub.firstCall.args[1]).to.eql(CONST.APISERVER.RESOURCE_TYPES.DEFAULT_BACKUP);
          expect(registerWatcherStub.firstCall.args[2].name).to.eql('bound startPoller');
          expect(registerWatcherStub.firstCall.args[3]).to.eql(`state in (${CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS})`);
          expect(_.size(baseStatusPoller.pollers)).to.eql(0);
          mocks.verify();
          registerWatcherStub.resetHistory();
          registerWatcherStub.restore();
          done();
        });
    });

  });
});
