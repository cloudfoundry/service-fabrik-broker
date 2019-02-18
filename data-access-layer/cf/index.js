'use strict';

const CloudControllerClient = require('./CloudControllerClient');
const UaaClient = require('./UaaClient');
const TokenIssuer = require('./TokenIssuer');
const TokenInfo = require('./TokenInfo');
const ResourceStream = require('./ResourceStream');
const ServiceFabrikClient = require('./ServiceFabrikClient');

exports.uaa = new UaaClient();
exports.tokenIssuer = new TokenIssuer(exports.uaa);
exports.cloudController = new CloudControllerClient(exports.tokenIssuer);
exports.serviceFabrikClient = new ServiceFabrikClient(exports.tokenIssuer);
exports.TokenInfo = TokenInfo;
exports.ResourceStream = ResourceStream;
