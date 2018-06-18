'use strict';

// const Etcd3EventMeshServer = require('./Etcd3EventMeshServer');
const ApiServerEventMesh = require('./ApiServerEventMesh');
const ApiServerLockManager = require('./ApiServerLockManager');
// const LockManager = require('./LockManager');

exports.server = new ApiServerEventMesh();
exports.lockManager = new ApiServerLockManager();
