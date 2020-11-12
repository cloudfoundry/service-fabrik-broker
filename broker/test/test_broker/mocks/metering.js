'use strict';

const nock = require('nock');
const config = require('@sf/app-config');

exports.mockAuthCall = mockAuthCall;
exports.mockFailedAuthCall = mockFailedAuthCall;
exports.mockSendUsageRecord = mockSendUsageRecord;


function mockAuthCall(mock_token) {
  const basicAuth = new Buffer(`${config.metering.client_id}:${config.metering.client_secret}`, 'utf8').toString('base64');
  return nock(config.metering.token_url, {
      reqheaders: {
        authorization: `Basic ${basicAuth}`
      }
    })
    .get('/oauth/token')
    .query({
      grant_type: 'client_credentials'
    })
    .reply(200, {
      'access_token': mock_token || 'eyJhbGciOiJSUzI1NiIsImprdSI6Imh0dHBzOi8',
      'token_type': 'bearer',
      'expires_in': 43199,
      'scope': 'uaa.resource',
      'jti': 'ca438af50a4846f1ae09e21aa50cfef8'
    });
}

function mockFailedAuthCall() {
  return nock(config.metering.token_url)
    .get('/oauth/token')
    .query({
      grant_type: 'client_credentials'
    })
    .reply(404);
}

function mockSendUsageRecord(token, response_code, test_body_fn) {
  return nock(config.metering.metering_url, {
      reqheaders: {
        authorization: `Bearer ${token}`
      }
    })
    .put('/usage/v2/usage/documents', test_body_fn || true)
    .query({
      timeBased: 'true'
    })
    .reply(response_code);
}