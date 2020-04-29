'use strict';

const config = require('@sf/app-config');
const _ = require('lodash');

if (!_.includes(config.disabled_apis, 'broker')) {
  exports.broker = require('./broker');
}
