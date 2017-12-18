'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const lib = require('../lib');
const VirtualHostAgent = lib.fabrik.VirtualHostAgent;

describe('fabrik', function () {
  describe('VirtualHostAgent', function () {
    /* jshint expr:true */

    const ip = '127.0.0.1';
    const ips = [ip];
    const port = 2727;
    const auth = {
      user: 'admin',
      pass: 'secret'
    };
    const response = {
      body: {}
    };
    const body = {};
    const parameters = {
      foo: 'bar'
    };
    const credentials = {
      password: 'secret'
    };
    const logs = [{
      level: 'info',
      msg: 'foo'
    }, {
      level: 'critical',
      msg: 'bar'
    }];
    let version = 2;
    let protocol = 'http';
    let pathname = 'foo';
    let expectedStatus;
    let api_version = '1.1';
    let supported_features = ['state', 'lifecycle', 'credentials', 'backup', 'multi_tenancy'];
    let url;
    let agent;
    let requestStub;
    const instanceId = '06e18533-48c9-4533-8686-603cbfa61c7e';

    function createAgent(opts) {
      return new VirtualHostAgent(_.assign({
        version: version,
        auth: auth,
        protocol: protocol,
        port: port
      }, opts));
    }

    function createUrl(pathname) {
      return `${protocol}://${ip}:${port}/v${version}/${pathname}`;
    }

    beforeEach(function () {
      url = createUrl(pathname);
      agent = createAgent();
      requestStub = sinon.stub(agent, 'request');
      requestStub
        .withArgs({
          method: 'GET',
          url: createUrl('info')
        }, 200)
        .returns(Promise.resolve({
          body: {
            api_version: api_version,
            supported_features: supported_features
          }
        }));
      requestStub
        .withArgs({
          method: 'POST',
          url: createUrl(pathname),
          auth: auth,
          body: body
        }, expectedStatus)
        .returns(Promise.resolve(response));
      requestStub
        .withArgs({
          method: 'DELETE',
          url: createUrl(pathname),
          auth: auth,
          body: body
        }, expectedStatus)
        .returns(Promise.resolve(response));
      requestStub
        .withArgs({
          method: 'GET',
          url: createUrl(pathname),
          auth: auth
        }, expectedStatus)
        .returns(Promise.resolve(response));
      requestStub
        .withArgs({
          method: 'GET',
          url: createUrl(pathname),
          auth: auth,
          json: false
        }, expectedStatus)
        .returns(Promise.resolve({
          body: _
            .chain(logs)
            .map(JSON.stringify)
            .join('\n')
            .value(),
        }));
    });

    afterEach(function () {
      requestStub.restore();
    });

    describe('#createVirtualHost', function () {
      before(function () {
        pathname = `tenants/${instanceId}`;
        expectedStatus = 200;
        _.set(body, 'parameters', {});
      });

      after(function () {
        _.unset(body, 'parameters');
      });

      it('returns a JSON object', function () {
        return agent
          .createVirtualHost(ips, instanceId)
          .then(() => {
            expect(requestStub).to.have.been.calledTwice;
          });
      });
    });

    describe('#deleteVirtualHost', function () {
      before(function () {
        pathname = `tenants/${instanceId}`;
        expectedStatus = 204;
        _.set(body, 'parameters', {});
      });

      it('returns a JSON object', function () {
        return agent
          .deleteVirtualHost(ips, instanceId)
          .then(() => {
            expect(requestStub).to.have.been.calledTwice;
          });
      });

    });

    describe('#createCredentials', function () {
      before(function () {
        pathname = `tenants/${instanceId}/credentials`;
        expectedStatus = 200;
        _.set(body, 'parameters', parameters);
      });

      after(function () {
        _.unset(body, 'parameters');
      });

      it('returns a JSON object', function () {
        return agent
          .createCredentials(ips, instanceId, parameters)
          .then(body => {
            expect(body).to.equal(response.body);
            expect(requestStub).to.have.been.calledTwice;
          });
      });
    });

    describe('#deleteCredentials', function () {
      before(function () {
        pathname = `tenants/${instanceId}/credentials`;
        expectedStatus = 204;
        _.set(body, 'credentials', credentials);
      });

      after(function () {
        _.unset(body, 'credentials');
      });

      it('returns a JSON object', function () {
        return agent
          .deleteCredentials(ips, instanceId, credentials)
          .then(() => {
            expect(requestStub).to.have.been.calledTwice;
          });
      });
    });
  });
});