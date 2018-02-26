'use strict';
const Promise = require('bluebird');

class BaseAction {
  static executePreCreate() {
    return Promise.resolve(0);
  }
  static executePostCreate() {
    return Promise.resolve(0);
  }
  static executePreDelete() {
    return Promise.resolve(0);
  }
  static executePostDelete() {
    return Promise.resolve(0);
  }
  static executePreUpdate() {
    return Promise.resolve(0);
  }

}

module.exports = BaseAction;