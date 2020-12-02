'use strict';

const Promise = require('bluebird');
const config = require('@sf/app-config');
const { HttpClient } = require('@sf/common-utils');

class QuotaAPIClient extends HttpClient {
  constructor(tokenIssuer) {
    super({
      baseURL: config.quota.serviceDomain,
      maxRedirects: 0,
      rejectUnauthorized: !config.skip_ssl_validation
    });
    this.tokenIssuer = tokenIssuer;
  }

  getQuota(subaccountId, service, plan) {
    const requestUrl = `/api/v2.0/subaccounts/${subaccountId}/services/${service}/plan/${plan}`;
    return Promise
      .try(() => this.tokenIssuer.getAccessToken())
      .then(accessToken => this
        .request({
          method: 'GET',
          url: requestUrl,
          auth: false,
          headers: {
            authorization: `Bearer ${accessToken}`
          }
        }, 200)
      )
      .then(res => {
        return res.body.quota;
      });
  }
}

module.exports = QuotaAPIClient;
