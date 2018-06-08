'use strict';

const Etcd3EventMeshServer = require('./Etcd3EventMeshServer');
const ApiServerEventMesh = require('./ApiServerEventMesh');
const LockManager = require('./LockManager');

exports.server = new ApiServerEventMesh();
exports.lockManager = new LockManager();