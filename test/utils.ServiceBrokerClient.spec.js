'use strict';

const brokerClient = require('../broker/lib/utils/ServiceBrokerClient');

describe('Utils', function () {
  describe('ServiceBrokerClient', function () {
    describe('#initiateBackup', function () {
      /* jshint expr:true */
      const body = {
        name: 'backup',
        guid: 'a6b39499-8b8b-4e1b-aaec-b2bc11d396e4'
      };
      const response = {
        statusCode: undefined,
        body: body
      };

      let requestSpy;

      beforeEach(function () {
        requestSpy = sinon.stub(brokerClient, 'request');
        requestSpy.returns(Promise.resolve(response));
        mocks.verify();
      });

      afterEach(function () {
        requestSpy.restore();
      });
    });
  });
});