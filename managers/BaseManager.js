'use strict';

const errors = require('../common/errors');
// const CONST = require('../common/constants');
// const lockManager = require('../eventmesh/LockManager');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class BaseManager {

  // acquireLock(resource) {
  //   return lockManager.etcdLock(resource);
  // }

  registerWatcher() {
    throw new NotImplementedBySubclass('registerWatcher');
  }

  worker() {
    throw new NotImplementedBySubclass('registerWatcher');
  }

}

module.exports = BaseManager;