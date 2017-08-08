'use strict';

process.env.NODE_ENV = 'test';

delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;

/*!
 * Common modules
 */
global.Promise = require('bluebird');
global.sinon = require('sinon');
global.Recorder = require('./Recorder');
global.mocks = require('../mocks')();
global.support = {
  jwt: require('./jwt')
};

/*!
 * Attach chai to global
 */
global.chai = require('chai');
global.expect = global.chai.expect;
/*!
 * Chai Plugins
 */
global.chai.use(require('sinon-chai'));
global.chai.use(require('chai-http'));