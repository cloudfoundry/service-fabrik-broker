'use strict';

const QuotaManager = require('./QuotaManager');
const QuotaAPIClient = require('./QuotaAPIClient');
const QuotaAPIAuthClient = require('./QuotaAPIAuthClient');
const TokenIssuer = require('./TokenIssuer');
const TokenInfo = require('./TokenInfo');

exports.quotaAPIAuthClient = new QuotaAPIAuthClient();
exports.tokenIssuer = new TokenIssuer(exports.quotaAPIAuthClient);
exports.quotaAPIClient = new QuotaAPIClient(exports.tokenIssuer);
exports.TokenInfo = TokenInfo;
exports.quotaManager = new QuotaManager(exports.quotaAPIClient);
