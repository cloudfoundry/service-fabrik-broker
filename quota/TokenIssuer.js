'use strict';

const Promise = require('bluebird');
const TokenInfo = require('./TokenInfo');
const logger = require('../common/logger');

class TokenIssuer {
  constructor(quotaAPIAuthClient) {
    this.quotaAPIAuthClient = quotaAPIAuthClient;
    this.tokenInfo = new TokenInfo();
  }

  clearTimeoutObject() {
    if (this.timeoutObject) {
      clearTimeout(this.timeoutObject);
      this.timeoutObject = undefined;
    }
  }
  refreshToken() {
    logger.silly(`Starting to refresh the Quota Management API accessToken which will expire in ${this.tokenInfo.accessTokenExpiresIn} seconds.`);
    return this.quotaAPIAuthClient.accessWithClientCredentials();
  }

  updateTokenInfo(tokenInfo) {
    this.tokenInfo.update(tokenInfo);
    const delay = this.tokenInfo.accessTokenExpiresIn - 15;
    if (delay > 0 && delay < 2147483647) {
      this.clearTimeoutObject();
      this.timeoutObject = setTimeout(() => {
        return this.refreshToken()
          .then(result => this.updateTokenInfo(result))
          .catch(err => logger.error(err.message));
      }, delay * 1000);
    }
    return this.tokenInfo;
  }

  getAccessToken() {
    logger.debug('Accessing token for Quota API');
    if (!this.tokenInfo.accessTokenExpiresSoon) {
      return Promise.resolve(this.tokenInfo.accessToken);
    }
    return this.refreshToken()
      .then(result => this.updateTokenInfo(result).accessToken);
  }
}

module.exports = TokenIssuer;