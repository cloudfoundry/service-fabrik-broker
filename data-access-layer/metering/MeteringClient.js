'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
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

  getAuthToken() {
    return this
      .request({
        baseUrl: this.tokenUrl,
        url: '/oauth/token',
        auth: {
          user: this.clientId,
          pass: this.clientSecret
        },
        qs: {
          grant_type: 'client_credentials'
        }
      }, 200)
      .then(res => {
        logger.debug('Metering auth response body', res.body);
        const serverResponse = JSON.parse(res.body);
        return serverResponse.access_token;
      })
      .catch(err => {
        logger.error('Error occurred while fetching metering auth token', err);
        throw err;
      });
  }

  putUsageRecord(usage_records) {
    return Promise
      .try(() => this.getAuthToken())
      .then(accessToken => this.request({
        url: '/usage/v2/usage/documents',
        method: CONST.HTTP_METHOD.PUT,
        auth: {
          bearer: accessToken
        },
        body: usage_records,
        json: true
      }, CONST.HTTP_STATUS_CODE.OK))
      .catch(err => {
        logger.error('Error occurred while seding usage to metering service', err);
        throw err;
      });
  }
}

module.exports = MeteringClient;