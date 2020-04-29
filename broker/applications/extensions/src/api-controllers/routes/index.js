'use strict';

const config = require('@sf/app-config');
const _ = require('lodash');
const express = require('express');

require('@sf/express-commons').middleware.enableAbsMatchingRouteLookup(express);
if (!_.includes(config.disabled_apis, 'api')) {
  exports.api = require('./api');
}
if (!_.includes(config.disabled_apis, 'manage')) {
  exports.manage = require('./manage');
}
