'use strict';

const _ = require('lodash');
const { CONST, HttpClient } = require('@sf/common-utils');
const config = require('@sf/app-config');

class QuotaAPIAuthClient extends HttpClient {
  constructor(options) {
    super(_.defaultsDeep({
      headers: {
        'Content-Type': CONST.QUOTA_API_AUTH_CLIENT.CONTENT_TYPE,
        Accept: CONST.QUOTA_API_AUTH_CLIENT.ACCEPT
      },
      followRedirect: false
    }, options, {
      baseUrl: config.quota.oauthDomain,
      rejectUnauthorized: !config.skip_ssl_validation
    }));
    this.clientId = config.quota.username;
    this.clientSecret = config.quota.password;
  }

  accessWithClientCredentials() {
    return this.request({
      method: 'POST',
      url: '/oauth/token',
      auth: {
        user: this.clientId,
        pass: this.clientSecret
      },
      form: {
        grant_type: 'client_credentials'
      }
    }, 200)
      .then(res => {
        return JSON.parse(res.body);
      });
  }
}

module.exports = QuotaAPIAuthClient;
