'use strict';

const _ = require('lodash');
const { CONST, HttpClient } = require('@sf/common-utils');
const config = require('@sf/app-config');
const logger = require('@sf/logger');

class BrokerMtlsAPIClient extends HttpClient {
  constructor(baseUrl, options) {
    super(_.defaultsDeep({
      headers: {
        ACCEPT: 'application/json'
      },
      maxRedirects: 0
    },
    options,
    {
      baseURL: baseUrl,
      rejectUnauthorized: !config.skip_ssl_validation
    }));
  }

  getCertificateInfo(baseUrl) {
    return this.request({
      method: 'GET',
      url: baseUrl,
      // timeout in msec
      timeout: _.get(config, 'smConnectionSettings.timeout', 0) * 1000,
      headers: {
        'content-type': 'application/json'
      }
    }, CONST.HTTP_STATUS_CODE.OK)
      .then(result => {
        return result.body;
      })
      .catch(err => {
        logger.error(`Caught error getting the certificate subject info for baseurl ${baseUrl} : ${err}`);
        throw new Error(`Error getting certificate subject info for ${baseUrl}, error: ${err}`);
      });
  }
}

module.exports = BrokerMtlsAPIClient;
