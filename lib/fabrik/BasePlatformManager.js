'use strict';

const CONST = require('../constants');

class BasePlatformManager {
  constructor(guid, context) {
    this.guid = guid;
    this.context = context;
  }

  get platform() {
    return this.context.platform;
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

  ensureTenantId(tenant_id) {
    /* jshint unused:false */
  }

  static getInstance(instance_id, context) {
    const PlatformManager = (context && CONST.PLATFORM_MANAGER[context.platform]) ? require(`./${CONST.PLATFORM_MANAGER[context.platform]}`) : undefined;  
    if (PlatformManager === undefined) {
      return new BasePlatformManager(instance_id, context);  
    } else { 
      return new PlatformManager(instance_id, context);  
    }
  }

}
module.exports = BasePlatformManager;