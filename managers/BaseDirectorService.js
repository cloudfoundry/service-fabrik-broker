'use strict';

const _ = require('lodash');
const utils = require('../common/utils');

class BaseDirectorService {
  constructor(plan) {
    this.plan = plan;
  }

  get settings() {
    return this.plan.manager.settings;
  }

  static parseDeploymentName(deploymentName, subnet) {
    return _
      .chain(utils.deploymentNameRegExp(subnet).exec(deploymentName))
      .slice(1)
      .tap(parts => parts[1] = parts.length ? parseInt(parts[1]) : undefined)
      .value();
  }
}

module.exports = BaseDirectorService;