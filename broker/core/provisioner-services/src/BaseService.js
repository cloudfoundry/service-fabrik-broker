'use strict';

const {
  CONST,
  commonFunctions: {
    getPlatformFromContext
  }
} = require('@sf/common-utils');
const Agent = require('@sf/service-agent');

class BaseService {
  constructor(plan) {
    this.plan = plan;
    this.agent = new Agent(this.settings.agent);
  }

  get settings() {
    return this.plan.manager.settings;
  }

  static get prefix() {
    return CONST.SERVICE_FABRIK_PREFIX;
  }

  get name() {
    return this.plan.manager.name;
  }

  get subnet() {
    return this.settings.subnet || this.service.subnet;
  }

  getTenantGuid(context) {
    let platform = getPlatformFromContext(context);
    if (platform === CONST.PLATFORM.CF) {
      return context.space_guid;
    } else if (platform === CONST.PLATFORM.K8S) {
      return context.namespace;
    }
  }

  get service() {
    return this.plan.service;
  }

}

module.exports = BaseService;
