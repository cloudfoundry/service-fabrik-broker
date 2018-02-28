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
  static executePostUpdate() {
    return Promise.resolve(0);
  }
  static executePreBind() {
    return Promise.resolve(0);
  }
  static executePostBind() {
    return Promise.resolve(0);
  }
  static executePreUnbind() {
    return Promise.resolve(0);
  }
  static executePostUnbind() {
    return Promise.resolve(0);
  }

}

module.exports = BaseAction;