'use strict';

const _ = require('lodash');

class BasePlatformManager {
  constructor(platform) {
    this.platform = platform;
  }

  getCatalog(catalog) {
    const modifiedCatalog = _.cloneDeep(catalog);
    const platform = this.platform;
    _.remove(modifiedCatalog.services, function (service) {
      _.remove(service.plans, function (plan) {
        return !_.includes(_.get(plan, 'supported_platform', ['cf']), platform);
      });
      return !_.includes(_.get(service, 'supported_platform', ['cf']), platform);
    });
    return modifiedCatalog;
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