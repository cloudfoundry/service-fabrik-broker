'use strict';

const BasePlatformManager = require('./BasePlatformManager');
const errors = require('../errors');
const NotImplemented = errors.NotImplemented;

class K8sPlatformManager extends BasePlatformManager {
  constructor(guid, manager, context) {
    super(guid, manager, context);
  }

  preInstanceProvisionOperations(options) {
    /* jshint unused:false */
    throw new NotImplemented('preInstanceProvisionOperations');
  }

  postInstanceProvisionOperations(options) {
    /* jshint unused:false */
    throw new NotImplemented('postInstanceProvisionOperations');
  }

  preInstanceDeleteOperations(options) {
    /* jshint unused:false */
    throw new NotImplemented('preInstanceDeleteOperations');
  }

  postInstanceUpdateOperations(options) {
    /* jshint unused:false */
    throw new NotImplemented('postInstanceUpdateOperations');
  }

  ensureTenantId(namespace) {
    /* jshint unused:false */
    throw new NotImplemented('ensureTenantId');
  }
}

module.exports = K8sPlatformManager;