'use strict';

const express = require('express');
require('@sf/express-commons').middleware.enableAbsMatchingRouteLookup(express);
exports.admin = require('./admin');
