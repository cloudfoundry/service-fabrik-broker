'use strict';

const _ = require('lodash');
const jwt = require('jsonwebtoken');
const nock = require('nock');
const parseUrl = require('url').parse;
const lib = require('../../broker/lib');
const config = lib.config;
const catalog = lib.models.catalog;
const tokenEndpointUrl = 'https://uaa.bosh-lite.com';
const authorizationEndpointUrl = 'https://login.bosh-lite.com';
const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjI1MzQwMjMwMDc5OSwidXNlcl9pZCI6Im1lIiwic2NvcGUiOlsib3BlbmlkIiwiY2xvdWRfY29udHJvbGxlci53cml0ZSIsImNsb3VkX2NvbnRyb2xsZXJfc2VydmljZV9wZXJtaXNzaW9ucy5yZWFkIl19.ClDfNqT9T1_5LicTpqNrHJ9Fv-UwkLVZNWG71PjCAVQ';
const jwtTokenInsufficientScopes = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjI1MzQwMjMwMDc5OSwidXNlcl9pZCI6Im1lIiwic2NvcGUiOlsib3BlbmlkIl19.5mRXvmEVV9g970m5XuQe-NlLP-z95jKj6W3sfnIfjBw';
const authorizationCode = 'F45jH';
const redirect_uri = `https://${config.external.host}/manage/auth/cf/callback`;
const user_id = 'me';
const user_name = 'me';
const email = 'me@example.org';
const adminJwtToken = jwt.sign({
  exp: Math.floor(new Date('2078-01-01') / 1000) + (60 * 60),
  user_id: 'admin',
  user_name: 'admin',
  email: 'admin@sap.com',
  scope: ['openid',
    'cloud_controller.admin',
    'cloud_controller.write',
    'cloud_controller_service_permissions.read'
  ]
}, 'secret');

exports.jwtToken = jwtToken;
exports.adminJwtToken = adminJwtToken;
exports.jwtTokenInsufficientScopes = jwtTokenInsufficientScopes;
exports.authorizationCode = authorizationCode;
exports.getAccessToken = getAccessToken;
exports.getAuthorizationCode = getAuthorizationCode;
exports.getAccessTokenWithAuthorizationCode = getAccessTokenWithAuthorizationCode;
exports.getUserInfo = getUserInfo;
exports.tokenKey = tokenKey;

function getAccessToken() {
  return nock(tokenEndpointUrl)
    .post('/oauth/token', {
      grant_type: 'password',
      client_id: 'cf',
      username: 'admin',
      password: 'admin'
    })
    .reply(200, {
      access_token: jwtToken,
      refresh_token: jwtToken,
      scope: 'cloud_controller.admin',
      token_type: 'bearer'
    });
}

function getAccessTokenWithAuthorizationCode(service_id) {
  const dashboard_client = catalog.getService(service_id).dashboard_client;
  const basicAuth = new Buffer(`${dashboard_client.id}:${dashboard_client.secret}`, 'utf8').toString('base64');
  return nock(tokenEndpointUrl, {
      reqheaders: {
        authorization: `Basic ${basicAuth}`
      }
    })
    .post('/oauth/token', {
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: redirect_uri
    })
    .reply(200, {
      access_token: jwtToken,
      refresh_token: jwtToken,
      token_type: 'bearer'
    });
}

function getUserInfo() {
  return nock(tokenEndpointUrl, {
      reqheaders: {
        authorization: `Bearer ${jwtToken}`
      }
    })
    .get('/userinfo')
    .query({
      schema: 'openid'
    })
    .reply(200, {
      user_name: user_name,
      email: email
    });
}

function tokenKey() {
  return nock(tokenEndpointUrl)
    .get('/token_key')
    .reply(200, {
      user_id: user_id,
      user_name: user_name,
      email: email,
      value: 'secret'
    });
}

function getAuthorizationCode(service_id) {
  const dashboard_client = catalog.getService(service_id).dashboard_client;
  return nock(authorizationEndpointUrl)
    .get('/oauth/authorize')
    .query(query => _
      .chain(query)
      .omit('state')
      .isEqual({
        response_type: 'code',
        client_id: dashboard_client.id,
        redirect_uri: redirect_uri,
        scope: 'cloud_controller_service_permissions.read openid'
      })
      .value()
    )
    .reply(302, null, {
      location: req => `${redirect_uri}?code=${authorizationCode}&state=${parseUrl(req.path, true).query.state}`
    });
}