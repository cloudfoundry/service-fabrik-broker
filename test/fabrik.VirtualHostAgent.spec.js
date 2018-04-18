'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const lib = require('../broker/lib');
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
    let version = 1;
    let protocol = 'http';
    let pathname = 'foo';
    let expectedStatus;
    let api_version = '1.1';
    let supported_features = ['state', 'lifecycle', 'credentials', 'backup', 'multi_tenancy'];
    let agent = createAgent();
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

    function createStubsForPost() {
      requestStub = sinon.stub(agent, 'request');
      requestStub
        .withArgs({
          method: 'POST',
          url: createUrl(pathname),
          auth: auth,
          body: body
        }, expectedStatus)
        .returns(Promise.resolve(response));
    }

    function createStubsForDelete() {
      requestStub = sinon.stub(agent, 'request');
      requestStub
        .withArgs({
          method: 'DELETE',
          url: createUrl(pathname),
          auth: auth,
          body: body
        }, expectedStatus)
        .returns(Promise.resolve(response));
    }

    beforeEach(function () {
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
          method: 'GET',
          url: `${protocol}://${ip}:${port}/info`
        }, 200)
        .returns(Promise.resolve({
          body: {
            api_version: api_version,
            supported_features: supported_features
          }
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
        createStubsForPost();
      });

      after(function () {
        _.unset(body, 'parameters');
      });

      it('returns a JSON object', function () {
        return agent
          .createVirtualHost(ips, instanceId)
          .then(() => {
            expect(requestStub).to.have.been.calledTwice;
            expect(requestStub.firstCall.args[0].method).to.eql('GET');
            expect(requestStub.secondCall.args[0].method).to.eql('POST');
          });
      });
    });

    describe('#deleteVirtualHost', function () {
      before(function () {
        pathname = `tenants/${instanceId}`;
        expectedStatus = 204;
        _.set(body, 'parameters', {});
        createStubsForDelete();
      });

      it('returns a JSON object', function () {
        return agent
          .deleteVirtualHost(ips, instanceId)
          .then(() => {
            expect(requestStub).to.have.been.calledTwice;
            expect(requestStub.firstCall.args[0].method).to.eql('GET');
            expect(requestStub.secondCall.args[0].method).to.eql('DELETE');
          });
      });

    });

    describe('#createCredentials', function () {
      before(function () {
        pathname = `tenants/${instanceId}/credentials`;
        expectedStatus = 200;
        _.set(body, 'parameters', parameters);
        createStubsForPost();
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
            expect(requestStub.firstCall.args[0].method).to.eql('GET');
            expect(requestStub.secondCall.args[0].method).to.eql('POST');
          });
      });
    });

    describe('#deleteCredentials', function () {
      before(function () {
        pathname = `tenants/${instanceId}/credentials`;
        expectedStatus = 204;
        _.set(body, 'credentials', credentials);
        createStubsForDelete();
      });

      after(function () {
        _.unset(body, 'credentials');
      });

      it('returns a JSON object', function () {
        return agent
          .deleteCredentials(ips, instanceId, credentials)
          .then(() => {
            expect(requestStub).to.have.been.calledTwice;
            expect(requestStub.firstCall.args[0].method).to.eql('GET');
            expect(requestStub.secondCall.args[0].method).to.eql('DELETE');
          });
      });
    });
  });
});