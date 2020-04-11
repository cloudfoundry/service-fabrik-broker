'use strict';

const config = require('@sf/app-config');
const _ = require('lodash');

if (!_.includes(config.disabled_apis, 'api')) {
  exports.api = require('./api');
}
if (!_.includes(config.disabled_apis, 'manage')) {
  exports.manage = require('./manage');
}
