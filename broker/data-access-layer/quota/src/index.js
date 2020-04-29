'use strict';

const { CONST } = require('@sf/common-utils');
const assert = require('assert');

const QuotaAPIClient = require('./QuotaAPIClient');
const QuotaAPIAuthClient = require('./QuotaAPIAuthClient');
const TokenIssuer = require('./TokenIssuer');
const TokenInfo = require('./TokenInfo');
const quotaAPIAuthClient = new QuotaAPIAuthClient();
const tokenIssuer = new TokenIssuer(quotaAPIAuthClient);
const quotaAPIClient = new QuotaAPIClient(tokenIssuer);
const getQuotaManagerInstance = function(platform) {
  assert.ok(platform === CONST.PLATFORM.CF || platform === CONST.PLATFORM.K8S, `Platform can be only ${CONST.PLATFORM.CF} or ${CONST.PLATFORM.K8S}`);
  if(platform === CONST.PLATFORM.CF) {
    const cfQuotaPlatformManager = require('./cf-platform-quota-manager').cfPlatformQuotaManager;
    return cfQuotaPlatformManager;
  } else{
    const k8sQuotaPlatformManager = require('./k8s-platform-quota-manager').k8sPlatformQuotaManager;
    return k8sQuotaPlatformManager;
  }
};
module.exports = {
  quotaAPIAuthClient,
  tokenIssuer,
  quotaAPIClient,
  TokenInfo,
  getQuotaManagerInstance
};
