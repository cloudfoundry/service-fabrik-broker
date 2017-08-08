'use strict';

const express = require('express');
require('../../utils/enableAbsMatchingRouteLookup')(express);
const router = module.exports = express.Router();
router.use('/v2', require('./v2'));