'use strict';

const K8SPlatformQuotaManager = require('./K8SPlatformQuotaManager');
exports.k8sPlatformQuotaManager = new K8SPlatformQuotaManager(require('..').quotaAPIClient);
