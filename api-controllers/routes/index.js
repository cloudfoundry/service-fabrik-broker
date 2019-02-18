'use strict';

const config = require('../../common/config');
const _ = require('lodash');

if (!_.includes(config.disabled_apis, 'broker')) {
  exports.broker = require('./broker');
}
if (!_.includes(config.disabled_apis, 'api')) {
  exports.api = require('./api');
}
if (!_.includes(config.disabled_apis, 'admin')) {
  exports.admin = require('./admin');
  exports.report = require('./report');
}
if (!_.includes(config.disabled_apis, 'manage')) {
  exports.manage = require('./manage');
}
