'use strict';

const express = require('express');

require('@sf/express-commons').middleware.enableAbsMatchingRouteLookup(express);
exports.api = require('./api');
exports.manage = require('./manage');
