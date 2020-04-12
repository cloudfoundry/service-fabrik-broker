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
      return apiserver.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.LOCK,
          CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, handler)
        .tap(stream => stream.write('{"foo":1}'))
        .then(stream => {
          // expect(handlerCalled).to.eql(true);
          expect(stream).to.not.eql(null);
        });
    });
  });
});