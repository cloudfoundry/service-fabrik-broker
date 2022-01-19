'use strict';

const _ = require('lodash');
const { CONST, HttpClient } = require('@sf/common-utils');
const config = require('@sf/app-config');
const qs = require('qs');

class QuotaAPIMtlsAuthClient extends HttpClient {
  constructor(options) {
    super(_.defaultsDeep({
      headers: {
        Accept: CONST.QUOTA_API_AUTH_CLIENT.ACCEPT
      },
      maxRedirects: 0
    }, options, {
      baseURL: (_.get(options, 'region')) ? (_.get(config.quota, ['regions', options.region, 'oauthDomain'])) : config.quota.oauthDomain,
      rejectUnauthorized: !config.skip_ssl_validation,
      mtlsEnabled: (_.get(options, 'region')) ? (_.get(config.quota, ['regions', options.region, 'mtls' ,'enabled'])) : config.quota.mtls.enabled,
      timeout: _.get(config, 'quota.timeout', 0) * 1000
    }));
    this.clientId = (_.get(options, 'region')) ? (_.get(config.quota, ['regions', options.region, 'mtls', 'client_id'])) : config.quota.mtls.client_id;
  }

  accessWithClientCredentials() {
    return this.request({
      method: 'POST',
      url: '/oauth/token',
      data: qs.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId
      }),
      timeout: _.get(config, 'quota.timeout', 0) * 1000,
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      }
    }, 200)
      .then(res => {
        return res.body;
      });
  }
}

module.exports = QuotaAPIMtlsAuthClient;
