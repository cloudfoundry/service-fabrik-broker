'use strict';

const express = require('express');
require('@sf/express-commons').middleware.enableAbsMatchingRouteLookup(express);
const router = module.exports = express.Router({
  mergeParams: true
});
router.use('/v2', require('./v2'));
router.use('/region/:region/v2',require('./v2'));
