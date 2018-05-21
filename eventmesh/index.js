'use strict';

const Etcd3EventMeshServer = require('./Etcd3EventMeshServer');
const LockManager = require('./LockManager');

exports.server = new Etcd3EventMeshServer();
exports.lockManager = new LockManager();