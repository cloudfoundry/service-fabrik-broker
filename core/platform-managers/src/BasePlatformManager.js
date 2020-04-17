'use strict';

const _ = require('lodash');
const Promise = require('bluebird');

const {
  CONST,
  errors: {
    UnprocessableEntity
  }
} = require('@sf/common-utils');
const config = require('@sf/app-config');

class BasePlatformManager {
  constructor(platform) {
    this.platform = platform;
  }

  get platformName() {
    return this.platform;
  }

  getCatalog(catalog) {
    const modifiedCatalog = _.cloneDeep(catalog);
    const platform = this.platform;
    _.remove(modifiedCatalog.services, function (service) {
      _.remove(service.plans, function (plan) {
        return !_.includes(_.get(plan, 'supported_platform', ['cf', 'sm']), platform);
      });
      return !_.includes(_.get(service, 'supported_platform', ['cf', 'sm']), platform);
    });
    return modifiedCatalog;
  }

  preUnbindOperations(options) {
    /* jshint unused:false */
  }

  preBindOperations(options) {
    /* jshint unused:false */
  }

  postBindOperations(options) {
    /* jshint unused:false */
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

  isMultiAzDeploymentEnabled() {
    return Promise.try(() => {
      if (config.multi_az_enabled === CONST.INTERNAL ||
        config.multi_az_enabled === CONST.ALL ||
        config.multi_az_enabled === true) {
        // Default implementation does not differentiate between internal / all clients. 
        // If additional checks are to be done for internal, then platform specific manager must override and provide impl.
        return true;
      } else if (config.multi_az_enabled === CONST.DISABLED || config.multi_az_enabled === false) {
        return false;
      }
      throw new UnprocessableEntity(`config.multi_az_enabled is set to ${config.multi_az_enabled}. Allowed values: [${CONST.INTERNAL}, ${CONST.ALL}/true, ${CONST.DISABLED}/false]`);
    });
  }

  ensureTenantId(options) {
    /* jshint unused:false */
  }

}
module.exports = BasePlatformManager;
