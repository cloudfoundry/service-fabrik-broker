'use strict';
const path = require('path');
const child_process = require('child_process');

process.env.NODE_ENV = 'test';
process.env.CONF_DIR = path.join(__dirname, '../../../applications/deployment_hooks/config');
process.env.SETTINGS_PATH = path.join(process.env.CONF_DIR, 'settings.yml');
process.env.NODE_CMD = 'node';
delete process.env.HTTP_PROXY;
delete process.env.http_proxy;
delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;

console.log('========================= HOOKS ==========================\n');

/* !
 * Common modules
 */

global.Promise = require('bluebird');
global.sinon = require('sinon');
global.Recorder = require('./Recorder');
global.mocks = require('../mocks')();

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

// Load action scripts after decoding them from base64 from config.
child_process.execSync(`node ${path.join(__dirname, '../../../applications/deployment_hooks/', 'lib', 'LoadDeploymentActions.js')}`);
