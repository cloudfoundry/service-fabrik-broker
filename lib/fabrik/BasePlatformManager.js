'use strict';

const errors = require('../errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class BasePlatformManager {
  constructor() {}

  preInstanceProvisionOperations() {
    throw new NotImplementedBySubclass('preInstanceProvisionOperations');
  }

  postInstanceProvisionOperations() {
    throw new NotImplementedBySubclass('postInstanceProvisionOperations');
  }

  preInstanceDeleteOperations() {
    throw new NotImplementedBySubclass('preInstanceDeleteOperations');
  }

  postInstanceDeleteOperations() {
    throw new NotImplementedBySubclass('postInstanceDeleteOperations');
  }

}
module.exports = BasePlatformManager;