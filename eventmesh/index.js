'use strict';

const ApiServerEventMesh = require('./ApiServerEventMesh');
const ApiServerLockManager = require('./ApiServerLockManager');

exports.server = new ApiServerEventMesh();
exports.lockManager = new ApiServerLockManager();