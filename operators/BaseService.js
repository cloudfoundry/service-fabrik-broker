'use strict';

const _ = require('lodash');
const CONST = require('../common/constants');
const Agent = require('../data-access-layer/service-agent');
const errors = require('../common/errors');
const NotImplemented = errors.NotImplemented;

class BaseService {
  constructor(plan) {
    this.plan = plan;
    this.agent = new Agent(this.settings.agent);
  }

  get settings() {
    return this.plan.manager.settings;
  }

  get subnet() {
    return this.settings.subnet || this.service.subnet;
  }

  getTenantGuid(context) {
    let platform = context.platform;
    if (platform === CONST.PLATFORM.SM) {
      platform = context.origin;
    }
    if (platform === CONST.PLATFORM.CF) {
      return context.space_guid;
    } else if (platform === CONST.PLATFORM.K8S) {
      return context.namespace;
    }
  }

  get service() {
    return this.plan.service;
  }

  verifyFeatureSupport(feature) {
    if (!_.includes(this.agent.features, feature)) {
      throw new NotImplemented(`Feature '${feature}' not supported`);
    }
  }
}

module.exports = BaseService;