'use strict';

const Promise = require('bluebird');
const config = require('../../../common/config');
const utils = require('../utils');
const HttpClient = utils.HttpClient;

class QuotaAPIClient extends HttpClient {
  constructor(tokenIssuer) {
    super({
      baseUrl: config.quota.serviceDomain,
      followRedirect: false,
      rejectUnauthorized: !config.skip_ssl_validation
    });
    this.tokenIssuer = tokenIssuer;
  }

  getQuota(org, service, plan) {
    return Promise
      .try(() => this.tokenIssuer.getAccessToken())
      .then(accessToken => this
        .request({
          method: 'GET',
          url: `/api/v2.0/orgs/${org}/services/${service}/plan/${plan}`,
          auth: {
            bearer: accessToken
          }
        }, 200)
      )
      .then((res) => {
        return JSON.parse(res.body).quota;
      });
  }
}

module.exports = QuotaAPIClient;