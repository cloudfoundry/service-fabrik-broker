'use strict';

const _ = require('lodash');
const { CONST, HttpClient } = require('@sf/common-utils');
const config = require('@sf/app-config');
const qs = require('qs');

class QuotaAPIAuthClient extends HttpClient {
  constructor(options) {
    super(_.defaultsDeep({
      headers: {
        Accept: CONST.QUOTA_API_AUTH_CLIENT.ACCEPT
      },
      maxRedirects: 0,
      auth: {
        username: (_.get(options, 'region')) ? (_.get(config.quota, ['regions', options.region, 'username'])) : config.quota.username,
        password: (_.get(options, 'region')) ? (_.get(config.quota, ['regions', options.region, 'password'])) : config.quota.password
      }
    }, options, {
      baseURL: (_.get(options, 'region')) ? (_.get(config.quota, ['regions', options.region, 'oauthDomain'])) : config.quota.oauthDomain,
      rejectUnauthorized: !config.skip_ssl_validation
    }));
  }

  accessWithClientCredentials() {
    return this.request({
      method: 'POST',
      url: '/oauth/token',
      data: qs.stringify({
        grant_type: 'client_credentials'
      }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    }, 200)
      .then(res => {
        return res.body;
      });
  }
}

module.exports = QuotaAPIAuthClient;
