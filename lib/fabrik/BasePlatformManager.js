'use strict';

const errors = require('../errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class BasePlatformManager {
  constructor(guid, manager, context) {
    this.guid = guid;
    this.manager = manager;
    this.context = context;
    this.platform = context.platform;
  }

  preInstanceProvisionOperations(options) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('preInstanceProvisionOperations');
  }

  postInstanceProvisionOperations(options) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('postInstanceProvisionOperations');
  }

  preInstanceDeleteOperations(options) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('preInstanceDeleteOperations');
  }

  postInstanceDeleteOperations(options) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('postInstanceDeleteOperations');
  }

  ensureTenantId(tenant_id) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('ensureTenantId');
  }

}
module.exports = BasePlatformManager;