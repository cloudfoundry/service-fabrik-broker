'use strict';

const _ = require('lodash');
const formatUrl = require('url').format;
const deploymentHookClient = require('../../applications/deployment_hooks/src/lib/utils/DeploymentHookClient');

describe('Utils', function () {
  describe('DeploymentHookClient', function () {
    describe('#executeDeploymentActions', function () {
      function buildExpectedRequestArgs(method, path, statusCode, data) {
        const options = {
          method: method,
          url: path,
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
        _.set(response, 'body', {});
        return [options, response.statusCode];
      }
      /* jshint expr:true */
      const body = {
        phase: 'phase',
        context: 'context'
      };
      const response = {
        statusCode: undefined,
        body: {}
      };
      let requestSpy;
      beforeEach(function () {
        requestSpy = sinon.stub(deploymentHookClient, 'request');
        requestSpy.returns(Promise.resolve(response));
        mocks.verify();
      });

      afterEach(function () {
        requestSpy.restore();
      });

      it('should execute deployment hooks successfully', function () {
        const [options, statusCode] = buildExpectedRequestArgs('POST',
          '/hook',
          200, body);
        return deploymentHookClient.executeDeploymentActions(body)
          .then(result => {
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.eql({});
          });
      });

    });
  });
});
