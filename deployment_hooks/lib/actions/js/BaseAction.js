'use strict';
const Promise = require('bluebird');

class BaseAction {
  //TODO
  // Post Lifecycle operations are not supported yet because of undefined and unknown nature of post actions
  static executePreCreate() {
    return Promise.resolve(0);
  }
  static executePreDelete() {
    return Promise.resolve(0);
  }
  static executePreUpdate() {
    return Promise.resolve(0);
  }
  static executePreBind() {
    return Promise.resolve(0);
  }
  static executePreUnbind() {
    return Promise.resolve(0);
  }

}

module.exports = BaseAction;