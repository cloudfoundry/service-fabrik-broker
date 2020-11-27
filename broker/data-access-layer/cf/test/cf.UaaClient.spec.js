'use strict';

const Promise = require('bluebird');
const uuid = require('uuid');
const proxyquire = require('proxyquire');

let authorizationEndpoint = 'https://login.bosh-lite.com';

const UaaClient = proxyquire('../src/UaaClient', {
  '@sf/app-config': {
    cf: {
      authorization_endpoint: authorizationEndpoint
    }
  }
});

class MockUaaClient extends UaaClient {
  constructor(body, statusCode) {
    super({});
    this.body = body;
    this.statusCode = statusCode;
  }

  request(options, expectedStatusCode) {
    expect(expectedStatusCode).to.equal(this.statusCode);

    return Promise.resolve({
      body: this.body,
      statusCode: this.statusCode
    });
  }
}

describe('cf', () => {
  describe('UaaClient', () => {
    describe('#authorizationUrl', () => {
      it('returns a string containing the authorization endpoint (scope is an array)', done => {
        let options = {
          scope: ['foo', 'bar']
        };

        expect(new MockUaaClient().authorizationUrl(options)).to.eql(`${authorizationEndpoint}/oauth/authorize?response_type=code&scope=foo%20bar`);
        done();
      });

      it('returns a string containing the authorization endpoint with login_hint', done => {
        let options = {
          scope: ['foo', 'bar']
        };

        expect(new MockUaaClient().authorizationUrl(options, 'uaa')).to.eql(`${authorizationEndpoint}/oauth/authorize?response_type=code&scope=foo%20bar&login_hint=%7B%22origin%22%3A%22uaa%22%7D`);
        done();
      });

      it('returns a string containing the authorization endpoint (scope is a string)', done => {
        let options = {
          scope: 'foo'
        };

        expect(new MockUaaClient().authorizationUrl(options)).to.eql(`${authorizationEndpoint}/oauth/authorize?response_type=code&scope=foo`);
        done();
      });
    });

    describe('#userInfo', () => {
      it('returns a JSON object', done => {
        let body = {
          uuid: uuid.v4()
        };

        new MockUaaClient(body, 200).userInfo('abc').then(content => {
          expect(content).to.eql(body);
          done();
        }).catch(done);
      });
    });

    describe('#accessWithAuthorizationCode', () => {
      it('returns a JSON object', done => {
        let body = {
          uuid: uuid.v4()
        };
        let client = {
          id: 1,
          secret: 2,
          redirect_uri: 3
        };

        new MockUaaClient(body, 200).accessWithAuthorizationCode(client, 500).then(content => {
          expect(content).to.deep.eql(body);
          done();
        }).catch(done);
      });
    });

    describe('#accessWithPassword', () => {
      it('returns a JSON object', done => {
        let body = {
          uuid: uuid.v4()
        };

        new MockUaaClient(body, 200).accessWithPassword('user', 'pass').then(content => {
          expect(content).to.deep.eql(body);
          done();
        }).catch(done);
      });
    });

    describe('#accessWithRefreshToken', () => {
      it('returns a JSON object', done => {
        let body = {
          uuid: uuid.v4()
        };

        new MockUaaClient(body, 200).accessWithRefreshToken('token').then(content => {
          expect(content).to.deep.eql(body);
          done();
        }).catch(done);
      });
    });

    describe('#accessWithClientCredentials', () => {
      it('returns a JSON object', done => {
        let body = {
          uuid: uuid.v4()
        };

        new MockUaaClient(body, 200).accessWithClientCredentials('client_id', 'client_secret').then(content => {
          expect(content).to.deep.eql(body);
          done();
        }).catch(done);
      });
    });
  });
});
