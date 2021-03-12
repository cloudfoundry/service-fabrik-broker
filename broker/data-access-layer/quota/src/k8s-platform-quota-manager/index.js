'use strict';

const K8SPlatformQuotaManager = require('./K8SPlatformQuotaManager');

const k8sPlatformQuotaManagersRegional = {};
for(let reg in require('..').regionalQuotaAPIClients) {
  k8sPlatformQuotaManagersRegional[reg] = new K8SPlatformQuotaManager(require('..').regionalQuotaAPIClients[reg]);
}

exports.k8sPlatformQuotaManager = new K8SPlatformQuotaManager(require('..').quotaAPIClient);
exports.k8sPlatformQuotaManagersRegional = k8sPlatformQuotaManagersRegional;
