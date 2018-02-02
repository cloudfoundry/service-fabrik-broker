'use strict';

class BaseAction {
  static executePreCreate() {}
  static executePostCreate() {}
  static executePreDelete() {}
  static executePostDelete() {}
}

module.exports = BaseAction;