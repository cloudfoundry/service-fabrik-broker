'use strict';

const nock = require('nock');
const logger = require('../../../deployment_hooks/lib/logger');

exports = module.exports = init;
exports.verify = verify;
exports.reset = reset;

function init() {
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');
  return exports;
}

function verify() {
  /* jshint expr:true */
  if (!nock.isDone()) {
    console.log('pending mocks: %j', nock.pendingMocks());
    logger.error('pending mocks: %j', nock.pendingMocks());
  }
  expect(nock.isDone()).to.be.true;
}

function reset() {
  nock.cleanAll();
}