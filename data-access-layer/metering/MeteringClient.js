// Ignored this as jshint currently does not support async await
/* jshint ignore:start */
'use strict';

const _ = require('lodash');
const config = require('../../common/config');
const utils = require('../../common/utils');
const HttpClient = utils.HttpClient;
const logger = require('../../common/logger');
const CONST = require('../../common/constants');

class MeteringClient extends HttpClient {

  constructor(options) {
    super(_.defaultsDeep({
      baseUrl: config.metering.metering_url,
      headers: {
        Accept: 'application/json',
      },
      followRedirect: false
    }, options));
    this.clientId = config.metering.client_id;
    this.clientSecret = config.metering.client_secret;
    this.tokenUrl = config.metering.token_url;
    this.meteringUrl = config.metering.metering_url;
  }

  async getAuthToken() {
    try {
      let res = await this
        .request({
          baseUrl: this.tokenUrl,
          url: CONST.URL.METERING_AUTH,
          auth: {
            user: this.clientId,
            pass: this.clientSecret
          },
          qs: {
            grant_type: 'client_credentials'
          }
        }, 200);
      const serverResponse = JSON.parse(res.body);
      return serverResponse.access_token;
    } catch (err) {
      logger.error('Error occurred while fetching metering auth token', err);
      throw err;
    }
  }

  async sendUsageRecord(usageRecords) {
    try {
      if (this.accessToken === undefined) {
        this.accessToken = await this.getAuthToken();
      }
      return this.request({
        url: CONST.URL.METERING_USAGE,
        method: CONST.HTTP_METHOD.PUT,
        auth: {
          bearer: this.accessToken
        },
        body: usageRecords,
        json: true
      }, CONST.HTTP_STATUS_CODE.OK);
    } catch (err) {
      logger.error('Error occurred while seding usage to metering service', err);
      throw err;
    };
  }
}

module.exports = MeteringClient;
/* jshint ignore:end */