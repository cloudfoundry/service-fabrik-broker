'use strict';

const BasePlatformManager = require('./BasePlatformManager');

class K8sPlatformManager extends BasePlatformManager {
  constructor(platform) {
    super(platform);
    this.platform = platform;
  }

  postInstanceProvisionOperations(options) {
    /* jshint unused:false */
  }

  preInstanceDeleteOperations(options) {
    /* jshint unused:false */
  }

  postInstanceUpdateOperations(options) {
    /* jshint unused:false */
  }

  ensureTenantId(options) {
    /* jshint unused:false */
  }

}
module.exports = K8sPlatformManager;