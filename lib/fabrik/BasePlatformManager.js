'use strict';

class BasePlatformManager {
  constructor(platform) {
    this.platform = platform;
  }

  performPlatformSpecificChecks() {

  }

  getPlatformSpecificCatalog(catalog) {
    return catalog;
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
module.exports = BasePlatformManager;