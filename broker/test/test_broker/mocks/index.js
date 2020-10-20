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
const logger = require('@sf/logger');

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

function verify(ignoreList = []) { 
  /* Due to change in order of execution of UTs, some mocks donot get hit. To overcome this, an optional ignoreList is sent by the UT */ 
  /* structure of an element of ignoreList : "<HTTP Request> <URL>"*/
  /* jshint expr:true */
  let nockPendingMocks = nock.pendingMocks();
  logger.info('checking mocks: %j', nockPendingMocks);
  logger.info('ignore mocks: %j', ignoreList);

  if(nockPendingMocks.length > 0) {
    nockPendingMocks.sort();
    ignoreList.sort();
    if(nockPendingMocks.length === ignoreList.length) {
      logger.info('Comparing pending mocks with ignore mocks');
      let count = 0;     
      for(let i = 0; i < ignoreList.length; i++) {
        if(nockPendingMocks[i] === ignoreList[i])
          count++;
      }
      if(count == ignoreList.length)
        reset();
    }    
  }
 
  if (!nock.isDone()) {
    logger.error('pending mocks: %j', nockPendingMocks);
  }
  expect(nock.isDone()).to.be.true;
}

function setup() {
  const tokenIssuer = require('@sf/cf').cloudController.tokenIssuer;
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