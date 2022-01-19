'use strict';

const { CONST } = require('@sf/common-utils');
const assert = require('assert');

const _ = require('lodash');
const config = require('@sf/app-config');

const QuotaAPIClient = require('./QuotaAPIClient');
const QuotaAPIAuthClient = require('./QuotaAPIAuthClient');
const QuotaAPIMtlsAuthClient = require('./QuotaAPIMtlsAuthClient');
const TokenIssuer = require('./TokenIssuer');
const TokenInfo = require('./TokenInfo');

const mtlsEnabled = _.get(config.quota, 'mtls.enabled', false);

let quotaAPIAuthClient = mtlsEnabled ? new QuotaAPIMtlsAuthClient() : new QuotaAPIAuthClient();
const tokenIssuer = new TokenIssuer(quotaAPIAuthClient);
const quotaAPIClient = new QuotaAPIClient(tokenIssuer);

const regionalQuotaAPIClients = {};
for (let reg in config.quota.regions) {
  let regionalMtlsEnabled = _.get(config.quota, ['regions', reg, 'mtls' ,'enabled']);
  let quotaAPIAuthClientRegional = regionalMtlsEnabled ? new QuotaAPIMtlsAuthClient({ region:reg }) : new QuotaAPIAuthClient({ region:reg });
  let tokenIssuerRegional = new TokenIssuer(quotaAPIAuthClientRegional);
  let regionalQuotaAPIClient = new QuotaAPIClient(tokenIssuerRegional, { region:reg });
  regionalQuotaAPIClients[reg] = regionalQuotaAPIClient;
}

const getQuotaManagerInstance = function(platform, region) {
  assert.ok(platform === CONST.PLATFORM.CF || platform === CONST.PLATFORM.K8S, `Platform can be only ${CONST.PLATFORM.CF} or ${CONST.PLATFORM.K8S}`);
  if(platform === CONST.PLATFORM.CF) {
    if(region == undefined) {
      const cfQuotaPlatformManager = require('./cf-platform-quota-manager').cfPlatformQuotaManager;
      return cfQuotaPlatformManager;
    }
    assert.ok(require('./cf-platform-quota-manager').cfPlatformQuotaManagersRegional[region] !== undefined, `No LPS service credentials found for region: ${region}`);
    const cfQuotaPlatformManager = require('./cf-platform-quota-manager').cfPlatformQuotaManagersRegional[region];
    return cfQuotaPlatformManager;
  } else{
    if(region == undefined) {
      const k8sQuotaPlatformManager = require('./k8s-platform-quota-manager').k8sPlatformQuotaManager;
      return k8sQuotaPlatformManager;
    }
    assert.ok(require('./k8s-platform-quota-manager').k8sPlatformQuotaManagersRegional[region] !== undefined, `No LPS service credentials found for region: ${region}`);
    const k8sQuotaPlatformManager = require('./k8s-platform-quota-manager').k8sPlatformQuotaManagersRegional[region];
    return k8sQuotaPlatformManager;
  }
};
module.exports = {
  quotaAPIAuthClient,
  tokenIssuer,
  quotaAPIClient,
  TokenInfo,
  getQuotaManagerInstance,
  regionalQuotaAPIClients
};
