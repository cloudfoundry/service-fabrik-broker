'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const config = require('../../common/config');
const utils = require('../../common/utils');
const HttpClient = utils.HttpClient;
const logger = require('../../common/logger');

class MeteringClient extends HttpClient {

  constructor(options) {
    super(_.defaultsDeep({
      baseUrl: config.metering.metering_url,
      headers: {
        Accept: 'application/json',
      },
      followRedirect: false
    }, options));
    this.clientid = config.metering.client_id;
    this.clientsecret = config.metering.client_secret;
    this.token_url = config.metering.token_url;
    this.metering_url = config.metering.metering_url;
  }

  getAuthToken() {
    return this
      .request({
        baseUrl: this.token_url,
        url: '/oauth/token',
        auth: {
          user: this.clientid,
          pass: this.clientsecret
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
        method: 'PUT',
        auth: {
          bearer: accessToken
        },
        body: usage_records,
        json: true
      }, 200))
      .catch(err => {
        logger.error('Error occurred while seding usage to metering service', err);
        throw err;
      });
  }
}

module.exports = MeteringClient;