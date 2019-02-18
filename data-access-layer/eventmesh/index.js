'use strict';

const ApiServerClient = require('./ApiServerClient');
const LockManager = require('./LockManager');

exports.apiServerClient = new ApiServerClient();
exports.lockManager = new LockManager();
