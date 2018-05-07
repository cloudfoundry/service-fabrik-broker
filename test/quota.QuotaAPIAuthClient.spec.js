'use strict';

const Promise = require('bluebird');
const uuid = require('uuid');
const proxyquire = require('proxyquire');

const QuotaAPIAuthClient = proxyquire('../broker/lib/quota/QuotaAPIAuthClient', {
  '../config': {
    quota: {
      enabled: false,
      oauthDomain: 'sap-provisioning',
      serviceDomain: 'tenant-onboarding-develop',
      username: 'clientId',
      password: 'clientSecret',
    }
  }
});

class MockQuotaAPIAuthClient extends QuotaAPIAuthClient {
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

describe('quota', () => {
  describe('QuotaAPIAuthClient', () => {
    describe('#accessWithClientCredentials', () => {
      it('returns a JSON object', (done) => {
        let body = {
          uuid: uuid.v4()
        };

        new MockQuotaAPIAuthClient(JSON.stringify(body), 200).accessWithClientCredentials().then((content) => {
          expect(content).to.eql(body);
          done();
        }).catch(done);
      });
    });
  });
});