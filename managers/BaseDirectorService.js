'use strict';

const _ = require('lodash');
const utils = require('../broker/lib/utils');

class BaseDirectorService {
  static parseDeploymentName(deploymentName, subnet) {
    return _
      .chain(utils.deploymentNameRegExp(subnet).exec(deploymentName))
      .slice(1)
      .tap(parts => parts[1] = parts.length ? parseInt(parts[1]) : undefined)
      .value();
  }
}

module.exports = BaseDirectorService;