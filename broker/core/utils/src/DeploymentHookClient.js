'use strict';

const config = require('@sf/app-config');
const HttpClient = require('./HttpClient');
const logger = require('@sf/logger');
class DeploymentHookClient extends HttpClient {
  constructor() {
    super({
      baseUrl: `${config.deployment_hooks.protocol}://${config.deployment_hooks.host}`,
      auth: {
        user: config.deployment_hooks.username,
        pass: config.deployment_hooks.password
      },
      headers: {
        Accept: 'application/json'
      },
      followRedirect: false,
      rejectUnauthorized: !config.skip_ssl_validation
    });
  }

  executeDeploymentActions(options) {
    logger.info(`-> Starting execution of actions: ${options.actions} in phase: ${options.phase} for deployment: ${options.context.deployment_name}`);
    return this
      .request({
        method: 'POST',
        url: '/hook',
        body: options,
        json: true
      }, 200)
      .then(res => res.body);
  }
}

module.exports = DeploymentHookClient;
