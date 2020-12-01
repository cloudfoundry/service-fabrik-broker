'use strict';

const _ = require('lodash');
const config = require('@sf/app-config');
const {
  CONST,
  HttpClient
} = require('@sf/common-utils');
const logger = require('@sf/logger');

class QuotaClient extends HttpClient {
  constructor(options) {
    super(_.defaultsDeep({
      baseURL: config.quota_app.quota_app_url,
      headers: {
        Accept: 'application/json'
      },
      maxRedirects: 0,
      auth: {
        username: config.quota_app.username,
        password: config.quota_app.password
      }
    }, options));
  }
  async checkQuotaValidity(options, instanceBasedQuota) {
    if(instanceBasedQuota) {
      return await this.getQuotaValidStatus(options);
    } else {
      return await this.putCompositeQuotaInfo(options);
    }
  }
  async getQuotaValidStatus(options) {
    const subaccountId = _.get(options, 'subaccountId');
    const res = await this.request({
      url: `${config.quota_app.quota_endpoint}/${subaccountId}/quota`,
      method: CONST.HTTP_METHOD.GET,
      params: _.get(options, 'queryParams'),
      responseType: 'json'
    }, CONST.HTTP_STATUS_CODE.OK);
    logger.info(`Quota app returned following quotaValidStatus: ${res.body.quotaValidStatus}`);
    return {
      quotaValid: res.body.quotaValidStatus,
      message: _.get(res.body, 'message')
    };
  }
  async putCompositeQuotaInfo(options) {
    const subaccountId = _.get(options, 'subaccountId');
    const res = await this.request({
      url: `${config.quota_app.quota_endpoint}/${subaccountId}/quota`,
      method: CONST.HTTP_METHOD.PUT,
      data: _.get(options, 'data'),
      responseType: 'json'
    }, CONST.HTTP_STATUS_CODE.OK);
    logger.info(`Quota app returned following quotaValidStatus: ${res.body.quotaValidStatus}`);
    return {
      quotaValid: res.body.quotaValidStatus,
      message: _.get(res.body, 'message')
    };
  }
}

module.exports = QuotaClient;
/* jshint ignore:end */
