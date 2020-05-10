'use strict';

const CFPlatformQuotaManager = require('./CFPlatformQuotaManager');
exports.cfPlatformQuotaManager = new CFPlatformQuotaManager(require('..').quotaAPIClient);
