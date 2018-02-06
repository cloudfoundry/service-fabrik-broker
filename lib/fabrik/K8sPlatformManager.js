'use strict';

const BasePlatformManager = require('./BasePlatformManager');

class K8sPlatformManager extends BasePlatformManager {
  constructor() {
    super();
  }

  preInstanceProvisionOperations() {}

  postInstanceProvisionOperations() {}

  preInstanceDeleteOperations() {}

  postInstanceDeleteOperations() {}
}

module.exports = K8sPlatformManager;