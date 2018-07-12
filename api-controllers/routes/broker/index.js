'use strict';

const express = require('express');
require('../../../common/utils/enableAbsMatchingRouteLookup')(express);
const router = module.exports = express.Router({
  mergeParams: true
});
router.use('/v2', require('./v2'));