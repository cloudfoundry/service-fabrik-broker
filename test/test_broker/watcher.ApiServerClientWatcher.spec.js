'use strict';

const apiserver = require('../../data-access-layer/eventmesh').apiServerClient;
const CONST = require('../../common/constants');

describe('WatcherRegistration', () => {
  describe('#regWatcher', () => {
    it('Should register watch on a resource', () => {
      let handlerCalled = false;
      function handler() {
        handlerCalled = true;
      }
      mocks.apiServerEventMesh.nockRegisterWatcher(CONST.APISERVER.RESOURCE_GROUPS.LOCK,
        CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, {
          labelSelector: '',
          timeoutSeconds: 600
        });
      return apiserver.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.LOCK,
          CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, handler)
        .tap(stream => stream.write('{"foo":1}'))
        .then(stream => {
          expect(stream).to.not.eql(null);
        });
    });
  });
});