'use strict';

const BasePlatformManager = require('./BasePlatformManager');

class CfPlatformManager extends BasePlatformManager {
  constructor() {
    super();
  }

  preInstanceProvisionOperations() {}

  postInstanceProvisionOperations() {}

  preInstanceDeleteOperations() {}

  postInstanceDeleteOperations() {}
}

module.exports = CfPlatformManager;