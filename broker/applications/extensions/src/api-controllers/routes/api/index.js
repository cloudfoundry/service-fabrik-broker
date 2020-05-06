'use strict';

const express = require('express');

const router = module.exports = express.Router();
router.use('/v1', require('./v1'));
