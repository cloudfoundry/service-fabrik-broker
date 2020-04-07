'use strict';

const Promise = require('bluebird');
const config = require('../common/config');
const HttpClient = require('../common/utils').HttpClient;

class QuotaAPIClient extends HttpClient {
  constructor(tokenIssuer) {
    super({
      baseUrl: config.quota.serviceDomain,
      followRedirect: false,
      rejectUnauthorized: !config.skip_ssl_validation
    });
    this.tokenIssuer = tokenIssuer;
  }

  getQuota(orgOrSubaccountId, service, plan, isSubaccount) {
    const requestUrl = `/api/v2.0/${isSubaccount ? 'subaccounts' : 'orgs'}/${orgOrSubaccountId}/services/${service}/plan/${plan}`;
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
