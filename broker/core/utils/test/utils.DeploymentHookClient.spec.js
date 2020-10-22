'use strict';

const _ = require('lodash');
const formatUrl = require('url').format;
const logger = require('@sf/logger');
const { DeploymentHookClient } = require('@sf/common-utils');
const deploymentHookClient = new DeploymentHookClient();

describe('Utils', function () {
  describe('DeploymentHookClient', function () {
    describe('#executeDeploymentActions', function () {
      function buildExpectedRequestArgs(method, path, statusCode, data) {
        const options = {
          method: method,
          url: path,
          headers: {
            'Content-type': 'application/json'
          },
          responseType: "json"
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
            options.data = data;
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
          .tap(result => logger.debug(`Response received with status code ${result.statusCode}`))
          .then(result => {
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.eql({});
          });
      });

    });
  });
});
