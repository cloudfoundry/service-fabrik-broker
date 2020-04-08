'use strict';

const QuotaManager = require('./QuotaManager');
const QuotaAPIClient = require('./QuotaAPIClient');
const QuotaAPIAuthClient = require('./QuotaAPIAuthClient');
const TokenIssuer = require('./TokenIssuer');
const TokenInfo = require('./TokenInfo');
const quotaAPIAuthClient = new QuotaAPIAuthClient();
const tokenIssuer = new TokenIssuer(quotaAPIAuthClient);
const quotaAPIClient = new QuotaAPIClient(tokenIssuer);
const quotaManager = new QuotaManager(quotaAPIClient);
module.exports = {
    quotaAPIAuthClient,
    tokenIssuer,
    quotaAPIClient,
    quotaManager,
    TokenInfo
}