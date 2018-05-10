'use strict';

const errors = require('../common/errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class BaseManager {

  registerWatcher() {
    throw new NotImplementedBySubclass('registerWatcher');
  }

  worker() {
    throw new NotImplementedBySubclass('registerWatcher');
  }

}

module.exports = BaseManager;