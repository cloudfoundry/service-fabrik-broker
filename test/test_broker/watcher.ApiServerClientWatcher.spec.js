'use strict';

const { apiServerClient } = require('@sf/eventmesh');
const { CONST } = require('@sf/common-utils');

describe('WatcherRegistration', () => {
  describe('#regWatcher', () => {
    it('Should register watch on a resource', () => {
      let handlerCalled = false;

      function handler() {
        handlerCalled = true;
      }
      return apiServerClient.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.LOCK,
        CONST.APISERVER.RESOURCE_TYPES.DEPLOYMENT_LOCKS, handler)
        .tap(stream => stream.write('{"foo":1}'))
        .then(stream => {
          // expect(handlerCalled).to.eql(true);
          expect(stream).to.not.eql(null);
        });
    });
  });
});
