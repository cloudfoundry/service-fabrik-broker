'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const nock = require('nock');
const azureClient = require('./azureClient');
const cloudController = require('./cloudController');
const cloudProvider = require('./cloudProvider');
const uaa = require('./uaa');
const director = require('./director');
const docker = require('./docker');
const agent = require('./agent');
const virtualHostAgent = require('./virtualHostAgent');
const serviceFabrikClient = require('./serviceFabrikClient');
const serviceBrokerClient = require('./serviceBrokerClient');
const lib = require('../../broker/lib');
const logger = lib.logger;

exports = module.exports = init;
exports.azureClient = azureClient;
exports.cloudController = cloudController;
exports.cloudProvider = cloudProvider;
exports.uaa = uaa;
exports.director = director;
exports.docker = docker;
exports.agent = agent;
exports.virtualHostAgent = virtualHostAgent;
exports.serviceFabrikClient = serviceFabrikClient;
exports.serviceBrokerClient = serviceBrokerClient;
exports.verify = verify;
exports.setup = setup;
exports.reset = reset;

function init() {
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
  return exports;
}

function verify() {
  /* jshint expr:true */
  if (!nock.isDone()) {
    logger.error('pending mocks: %j', nock.pendingMocks());
  }
  expect(nock.isDone()).to.be.true;
}

function setup() {
  const tokenIssuer = lib.cf.cloudController.tokenIssuer;
  tokenIssuer.logout();
  mocks.uaa.getAccessToken();
  return Promise
    .all(_.concat([tokenIssuer.getAccessToken()], ...arguments))
    .then(verify)
    .finally(reset);
}

function reset() {
  nock.cleanAll();
}