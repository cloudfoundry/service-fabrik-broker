'use strict';

const _ = require('lodash');
const config = require('../lib/config');
const formatUrl = require('url').format;
const brokerClient = require('../lib/utils').serviceBrokerClient;

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

      function buildExpectedRequestArgs(method, path, statusCode, data) {
        const options = {
          method: method,
          url: path,
          auth: {
            user: config.username,
            pass: config.password
          },
          json: true
        };
        if (_.isObject(statusCode)) {
          data = statusCode;
          statusCode = undefined;
        }
        if (data) {
          if (_.includes(['GET', 'DELETE'], method)) {
            options.url = formatUrl({
              pathname: options.url,
              query: data
            });
          } else {
            options.body = data;
          }
        }
        _.set(response, 'statusCode', statusCode || 200);
        return [options, response.statusCode];
      }

      beforeEach(function () {
        requestSpy = sinon.stub(brokerClient, 'request');
        requestSpy.returns(Promise.resolve(response));
        mocks.verify();
      });

      afterEach(function () {
        requestSpy.restore();
      });

      it('should initiate backup successfully', function () {
        const [options, statusCode] = buildExpectedRequestArgs('POST',
          '/admin/service-fabrik/backup',
          202);
        return brokerClient.startServiceFabrikBackup()
          .then(result => {
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.eql(body);
          });
      });
    });
  });
});