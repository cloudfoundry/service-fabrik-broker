'use strict';

const BasePlatformManager = require('./BasePlatformManager');

class CfPlatformManager extends BasePlatformManager {
  constructor(guid, manager) {
    super(guid, manager);
  }

  preInstanceProvisionOperations() {}

  postInstanceProvisionOperations() {}

  preInstanceDeleteOperations() {}

  postInstanceDeleteOperations() {}
}

module.exports = CfPlatformManager;