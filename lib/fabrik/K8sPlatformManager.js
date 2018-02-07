'use strict';

const BasePlatformManager = require('./BasePlatformManager');

class K8sPlatformManager extends BasePlatformManager {
  constructor(guid, manager) {
    super(guid, manager);
  }

  preInstanceProvisionOperations() {}

  postInstanceProvisionOperations() {}

  preInstanceDeleteOperations() {}

  postInstanceDeleteOperations() {}
}

module.exports = K8sPlatformManager;