'use strict';

const Promise = require('bluebird');
const config = require('@sf/app-config');
const { HttpClient } = require('@sf/common-utils');

class QuotaAPIClient extends HttpClient {
  constructor(tokenIssuer) {
    super({
      baseUrl: config.quota.serviceDomain,
      followRedirect: false,
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
          auth: {
            bearer: accessToken
          }
        }, 200)
      )
      .then(res => {
        return JSON.parse(res.body).quota;
      });
  }
}

module.exports = QuotaAPIClient;
