// Ignored this as jshint currently does not support async await
/* jshint ignore:start */
'use strict';

const _ = require('lodash');
const config = require('@sf/app-config');
const { TokenInfo } = require('@sf/quota');
const {
  CONST,
  AxiosHttpClient
} = require('@sf/common-utils');

class MeteringClient extends AxiosHttpClient {

  constructor(options) {
    super(_.defaultsDeep({
      baseURL: config.metering.metering_url,
      headers: {
        Accept: 'application/json'
      },
      maxRedirects: 10
    }, options));
    this.clientId = config.metering.client_id;
    this.clientSecret = config.metering.client_secret;
    this.tokenUrl = config.metering.token_url;
    this.meteringUrl = config.metering.metering_url;
    this.tokenInfo = new TokenInfo();
  }

  async getAuthToken() {
    let res = await this
      .request({
        baseURL: this.tokenUrl,
        url: CONST.URL.METERING_AUTH,
        auth: {
          username: this.clientId,
          password: this.clientSecret
        },
        params: {
          grant_type: 'client_credentials'
        }
      }, 200);
    const serverResponse = res.body;
    return serverResponse.access_token;
  }

  async sendUsageRecord(usageRecords) {
    if (this.tokenInfo.expiresSoon(this.tokenInfo.accessToken) === true) {
      this.tokenInfo.accessToken = await this.getAuthToken();
    }
    return this.request({
      url: CONST.URL.METERING_USAGE,
      method: CONST.HTTP_METHOD.PUT,
      params: {
        timeBased: 'true'
      },
      data: usageRecords,
      auth: false,
      headers: {
        authorization: `Bearer ${this.tokenInfo.accessToken}`,
        'Content-type': 'application/json'
      },
      responseType: 'json'
    }, CONST.HTTP_STATUS_CODE.OK);
  }
}

module.exports = MeteringClient;
/* jshint ignore:end */
