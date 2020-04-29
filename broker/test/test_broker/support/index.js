'use strict';
const path = require('path');
process.env.NODE_ENV = 'test';
process.env.CONF_DIR = path.join(__dirname, '../../../config');
process.env.SETTINGS_PATH = path.join(process.env.CONF_DIR, 'settings.yml');
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;

console.log('========================= BROKER ==========================\n');

/* !
 * Common modules
 */
global.Promise = require('bluebird');
global.sinon = require('sinon');
global.Recorder = require('./Recorder');
global.mocks = require('../mocks')();

// At app start DB Manager automatically fires this request before anything has started. So setting this mock to start with.
// getBindingProperty(CONST.FABRIK_INTERNAL_MONGO_DB.BINDING_ID, {}, config.mongodb.deployment_name, 'NOTFOUND');
mocks.director.getDeployments({
  oob: true
});

global.support = {
  jwt: require('./jwt')
};

/* !
 * Attach chai to global
 */
global.chai = require('chai');
global.expect = global.chai.expect;
/* !
 * Chai Plugins
 */
global.chai.use(require('sinon-chai'));
global.chai.use(require('chai-http'));
