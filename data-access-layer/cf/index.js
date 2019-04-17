'use strict';

const config = require('../../common/config');
const CloudControllerClient = require('./CloudControllerClient');
const UaaClient = require('./UaaClient');
const TokenIssuer = require('./TokenIssuer');
const TokenInfo = require('./TokenInfo');
const ResourceStream = require('./ResourceStream');
exports.uaa = new UaaClient();
exports.tokenIssuer = new TokenIssuer(exports.uaa);

if (config.external) {
  const ServiceFabrikClient = require('./ServiceFabrikClient');
  exports.serviceFabrikClient = new ServiceFabrikClient(exports.tokenIssuer);
}
exports.cloudController = new CloudControllerClient(exports.tokenIssuer);
exports.TokenInfo = TokenInfo;
exports.ResourceStream = ResourceStream;
