'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const nock = require('nock');
const azureClient = require('./azureClient');
const cloudController = require('./cloudController');
const cloudProvider = require('./cloudProvider');
const uaa = require('./uaa');
const metering = require('./metering');
const director = require('./director');
const docker = require('./docker');
const agent = require('./agent');
const virtualHostAgent = require('./virtualHostAgent');
const multitenancyAgent = require('./multitenancyAgent');
const serviceFabrikClient = require('./serviceFabrikClient');
const serviceBrokerClient = require('./serviceBrokerClient');
const deploymentHookClient = require('./deploymentHookClient');
const apiServerEventMesh = require('./apiServerEventMesh');
const logger = require('../../../common/logger');

exports = module.exports = init;
exports.azureClient = azureClient;
exports.cloudController = cloudController;
exports.cloudProvider = cloudProvider;
exports.uaa = uaa;
exports.metering = metering;
exports.director = director;
exports.docker = docker;
exports.agent = agent;
exports.virtualHostAgent = virtualHostAgent;
exports.multitenancyAgent = multitenancyAgent;
exports.serviceFabrikClient = serviceFabrikClient;
exports.serviceBrokerClient = serviceBrokerClient;
exports.deploymentHookClient = deploymentHookClient;
exports.apiServerEventMesh = apiServerEventMesh;
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
  const tokenIssuer = require('../../../data-access-layer/cf').cloudController.tokenIssuer;
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