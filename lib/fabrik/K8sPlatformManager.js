'use strict';

const BasePlatformManager = require('./BasePlatformManager');
const _ = require('lodash');

class K8sPlatformManager extends BasePlatformManager {
  constructor(platform) {
    super(platform);
    this.platform = platform;
  }

  getPlatformSpecificCatalog(catalog) {
    const modifiedCatalog = _.cloneDeep(catalog);
    const platform = this.platform;
    _.remove(modifiedCatalog.services, function (service) {
      _.remove(service.plans, function (plan) {
        return !_.includes(_.get(plan, 'supported_platform'), platform);
      });
      return !_.includes(_.get(service, 'supported_platform'), platform);
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
module.exports = K8sPlatformManager;