'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const proxyquire = require('proxyquire');

const QuotaAPIClient = proxyquire('../../data-access-layer/quota/src/QuotaAPIClient', {
  '@sf/app-config': {
    quota: {
      enabled: false,
      oauthDomain: 'sap-provisioning',
      serviceDomain: 'tenant-onboarding-develop',
      username: 'clientId',
      password: 'clientSecret'
    }
  }
});

describe('quota', function () {
  describe('QuotaAPIClient', function () {
    /* jshint expr:true */
    const org = 'org';
    const subaccount = 'subaccount';
    const service = 'service';
    const plan = 'plan';
    const bearer = 'bearer';
    const body = '{ "quota": 2 }';
    const response = {
      statusCode: undefined,
      body: body
    };
    const tokenIssuerStub = {
      getAccessToken: () => undefined
    };
    const quotaAPIClient = new QuotaAPIClient(tokenIssuerStub);
    let requestSpy, getAccessTokenSpy;

    function buildExpectedRequestArgs(method, url, statusCode) {
      const options = {
        method: method,
        url: url,
        auth: {
          bearer: bearer
        }
      };
      _.set(response, 'statusCode', statusCode || 200);
      return [options, response.statusCode];
    }

    beforeEach(function () {
      requestSpy = sinon.stub(quotaAPIClient, 'request');
      requestSpy.returns(Promise.resolve(response));
      getAccessTokenSpy = sinon.stub(tokenIssuerStub, 'getAccessToken');
      getAccessTokenSpy.returns(Promise.resolve(bearer));
    });

    afterEach(function () {
      requestSpy.restore();
      getAccessTokenSpy.restore();
    });

    describe('#getQuota', function () {
      it('should return integer with Status 200 for org quota', () => {
        const [options, statusCode] = buildExpectedRequestArgs('GET', `/api/v2.0/orgs/${org}/services/${service}/plan/${plan}`);
        return quotaAPIClient.getQuota(org, service, plan, false)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(JSON.parse(body).quota);
          });
      });
      it('should return integer with Status 200 for subaccount quota', () => {
        const [options, statusCode] = buildExpectedRequestArgs('GET', `/api/v2.0/subaccounts/${subaccount}/services/${service}/plan/${plan}`);
        return quotaAPIClient.getQuota(subaccount, service, plan, true)
          .then(result => {
            expect(getAccessTokenSpy).to.be.calledOnce;
            expect(requestSpy).to.be.calledWithExactly(options, statusCode);
            expect(result).to.equal(JSON.parse(body).quota);
          });
      });
    });
  });
});
