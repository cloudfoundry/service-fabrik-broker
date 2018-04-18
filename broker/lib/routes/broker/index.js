'use strict';

const express = require('express');
require('../../utils/enableAbsMatchingRouteLookup')(express);
const router = module.exports = express.Router({
  mergeParams: true
});
router.use('/v2', require('./v2'));