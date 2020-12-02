'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const {
  errors: {
    FeatureNotSupportedByAnyAgent
  }
} = require('@sf/common-utils');
const Agent = require('@sf/service-agent');

describe('fabrik', function () {
  describe('Agent', function () {
    /* jshint expr:true */

    const ip = '127.0.0.1';
    const ips = [ip];
    const port = 2727;
    const auth = {
      username: 'admin',
      password: 'admin'
    };
    const response = {
      body: {}
    };
    const body = {};
    const parameters = {
      foo: 'bar'
    };
    const preBindResponse = {};
    const preUnbindResponse = {};
    const credentials = {
      password: 'secret'
    };
    const backup = {
      guid: '071acb05-66a3-471b-af3c-8bbf1e4180be'
    };
    const vms = [{
      cid: '081e3263-e066-4a5a-868f-b420c72a260d',
      job: 'blueprint_z1',
      index: 0
    }];
    const logs = [{
      level: 'info',
      msg: 'foo'
    }, {
      level: 'critical',
      msg: 'bar'
    }];
    let context = {
      params: {
        previous_manifest: {
          name: 'test-deployment-name',
          instance_groups: [{
            name: 'bp',
            jobs: [{
              name: 'broker-agent',
              properties: {
                username: 'admin',
                password: 'admin'
              }
            }]
          }]
        }
      }
    };
    const state = 'processing';
    const operational = true;
    let version = 1;
    let protocol = 'http';
    let pathname = 'foo';
    let expectedStatus;
    let api_version = '1';
    let supported_features = ['state', 'lifecycle', 'credentials', 'backup', 'lifecycle.preupdate'];
    let url;
    let agent;
    let requestStub;

    function createAgent(opts) {
      return new Agent(_.assign({
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
          method: 'GET',
          url: `${protocol}://${ip}:${port}/info`
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
          data: body
        }, expectedStatus)
        .returns(Promise.resolve(response));
      requestStub
        .withArgs({
          method: 'POST',
          url: createUrl(pathname),
          auth: auth,
          data: context
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
          responseType: 'text'
        }, expectedStatus)
        .returns(Promise.resolve({
          body: _
            .chain(logs)
            .map(JSON.stringify)
            .join('\n')
            .value()
        }));
    });

    afterEach(function () {
      requestStub.restore();
    });

    describe('#basePath', function () {
      it('returns a string', function () {
        return agent
          .basePath(ip)
          .then(path => expect(path).to.equal(`/v${version}`));
      });
    });

    describe('#auth', function () {
      it('returns an object', function () {
        expect(agent.auth).to.equal(auth);
      });
    });

    describe('#protocol', function () {
      it('should return the specified protocol', function () {
        expect(agent.protocol).to.equal(protocol);
      });

      it('should return the default protocol', function () {
        agent = createAgent({
          protocol: undefined
        });
        expect(agent.protocol).to.equal('http');
      });
    });

    describe('#port', function () {
      it('should return the specified port ', function () {
        expect(agent.port).to.equal(port);
      });

      it('should return the default port when no port is specified', function () {
        agent = createAgent({
          port: undefined
        });
        expect(agent.port).to.equal(2718);
      });
    });

    describe('#getUrl', function () {
      before(function () {
        expectedStatus = 200;
      });
      it('returns a formatted url', function () {
        return agent
          .getUrl(ip, pathname)
          .then(hostUrl => {
            expect(hostUrl).to.equal(url);
          });
      });
    });

    describe('#getHost', function () {
      it('should return the given ip', function () {
        return agent
          .getHost(ips, 'state')
          .then(host => {
            expect(host).to.equal(ip);
          });
      });

      it('should throw an Error if feature is not supported', function () {
        return agent
          .getHost(ips, 'unsupported feature')
          .then(expect.fail)
          .catchReturn(FeatureNotSupportedByAnyAgent, null);
      });
      describe('where api version is 1', function () {
        const store = {};

        before(function () {
          store.api_version = api_version;
          store.supported_features = supported_features;
          api_version = '1';
          supported_features = ['credentials'];
        });

        after(function () {
          api_version = store.api_version;
          supported_features = store.supported_features;
        });

        it('should return the given ip', function () {
          return agent
            .getHost(ips, 'credentials')
            .then(host => {
              expect(host).to.equal(ip);
            });
        });

        it('should throw an Error if feature not \'credentials\'', function () {
          return agent
            .getHost(ips, 'state')
            .then(expect.fail)
            .catchReturn(FeatureNotSupportedByAnyAgent, null);
        });

      });
    });

    describe('#post', function () {
      before(function () {
        expectedStatus = 200;
      });

      it('returns a JSON object', function () {
        return agent
          .post(ip, pathname, body)
          .then(body => {
            expect(body).to.equal(response.body);
            expect(requestStub).to.have.been.calledOnce;
          });
      });
    });

    describe('#getState', function () {
      before(function () {
        pathname = 'state';
        expectedStatus = 200;
        _.set(body, 'operational', operational);
      });

      after(function () {
        _.unset(body, 'operational');
      });

      it('returns a JSON object', function () {
        return agent
          .getState(ips)
          .then(body => {
            expect(body).to.equal(response.body);
            expect(requestStub).to.have.been.calledTwice;
          });
      });
    });

    describe('#deprovision', function () {
      before(function () {
        pathname = 'lifecycle/deprovision';
        expectedStatus = 200;
      });

      it('returns a JSON object', function () {
        return agent
          .deprovision(ips)
          .then(body => {
            expect(body).to.equal(response.body);
            expect(requestStub).to.have.been.calledTwice;
          });
      });

    });

    describe('#preupdate', function () {
      before(function () {
        pathname = 'lifecycle/preupdate';
        expectedStatus = 200;
        context = context;
      });

      it('returns a JSON object', function () {
        return agent
          .preUpdate(ips, context)
          .then(body => {
            expect(body).to.equal(response.body);
            expect(requestStub).to.have.been.calledTwice;
          });
      });
    });

    describe('#createCredentials', function () {
      before(function () {
        pathname = 'credentials/create';
        expectedStatus = 200;
        _.set(body, 'parameters', parameters);
        _.set(body, 'actions', preBindResponse);
      });

      after(function () {
        _.unset(body, 'parameters');
        _.unset(body, 'actions');
      });

      it('returns a JSON object', function () {
        return agent
          .createCredentials(ips, parameters, preBindResponse)
          .then(body => {
            expect(body).to.equal(response.body);
            expect(requestStub).to.have.been.calledTwice;
          });
      });
    });

    describe('#deleteCredentials', function () {
      before(function () {
        pathname = 'credentials/delete';
        expectedStatus = 200;
        _.set(body, 'credentials', credentials);
        _.set(body, 'actions', preUnbindResponse);
      });

      after(function () {
        _.unset(body, 'credentials');
        _.unset(body, 'actions');
      });

      it('returns a JSON object', function () {
        return agent
          .deleteCredentials(ips, credentials, preUnbindResponse)
          .then(body => {
            expect(body).to.equal(response.body);
            expect(requestStub).to.have.been.calledTwice;
          });
      });
    });

    describe('#startBackup', function () {
      before(function () {
        pathname = 'backup/start';
        expectedStatus = 202;
        _.set(body, 'backup', backup);
        _.set(body, 'vms', vms);
      });

      after(function () {
        _.unset(body, 'backup');
        _.unset(body, 'vms');
      });

      it('returns a JSON object', function () {
        return agent
          .startBackup(ip, backup, vms)
          .then(() => {
            expect(requestStub).to.have.been.calledOnce;
          });
      });
    });

    describe('#abortBackup', function () {
      before(function () {
        pathname = 'backup/abort';
        expectedStatus = 202;
      });

      it('returns a JSON object', function () {
        return agent
          .abortBackup(ip)
          .then(body => {
            expect(body).to.equal(response.body);
            expect(requestStub).to.have.been.calledOnce;
          });
      });
    });

    describe('#getBackupLastOperation', function () {
      before(function () {
        pathname = 'backup';
        expectedStatus = 200;
        _.set(body, 'state', state);
      });

      after(function () {
        _.unset(body, 'state');
      });

      it('returns a JSON object', function () {
        return agent
          .getBackupLastOperation(ip)
          .then(body => {
            expect(body).to.equal(response.body);
            expect(requestStub).to.have.been.calledOnce;
          });
      });
    });

    describe('#getBackupLogs', function () {
      before(function () {
        pathname = 'backup/logs';
        expectedStatus = 200;
      });

      it('returns newline-separated stringified objects', function () {
        return agent
          .getBackupLogs(ip)
          .then(body => {
            expect(body).to.eql(logs);
            expect(requestStub).to.have.been.calledOnce;
          });
      });
    });
  });
});
