'use strict';

const QuotaAPIClient = require('./QuotaAPIClient');
const QuotaAPIAuthClient = require('./QuotaAPIAuthClient');
const TokenIssuer = require('./TokenIssuer');

exports.quotaAPIAuthClient = new QuotaAPIAuthClient();
exports.tokenIssuer = new TokenIssuer(exports.quotaAPIAuthClient);
exports.quotaAPIClient = new QuotaAPIClient(exports.tokenIssuer);
