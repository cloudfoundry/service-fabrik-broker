'use strict';

const CFPlatformQuotaManager = require('./CFPlatformQuotaManager');

const cfPlatformQuotaManagersRegional = {};
for(let reg in require('..').regionalQuotaAPIClients) {
  cfPlatformQuotaManagersRegional[reg] = new CFPlatformQuotaManager(require('..').regionalQuotaAPIClients[reg]);
}

exports.cfPlatformQuotaManager = new CFPlatformQuotaManager(require('..').quotaAPIClient);
exports.cfPlatformQuotaManagersRegional = cfPlatformQuotaManagersRegional;
