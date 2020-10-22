'use strict';

const config = require('@sf/app-config');
const AxiosHttpClient = require('./AxiosHttpClient');
const logger = require('@sf/logger');
class DeploymentHookClient extends AxiosHttpClient {
  constructor() {
    super({
      baseURL: `${config.deployment_hooks.protocol}://${config.deployment_hooks.host}`,
      auth: {
        username: config.deployment_hooks.username,
        password: config.deployment_hooks.password
      },
      headers: {
        Accept: 'application/json'
      },
      maxRedirects: 0,
      rejectUnauthorized: !config.skip_ssl_validation
    });
  }

  executeDeploymentActions(options) {
    logger.info(`-> Starting execution of actions: ${options.actions} in phase: ${options.phase} for deployment: ${options.context.deployment_name}`);
    return this
      .request({
        method: 'POST',
        url: '/hook',
        data: options,
        headers: {
          'Content-type': 'application/json'
        },
        responseType: 'json'
      }, 200)
      .then(res => res.body);
  }
}

module.exports = DeploymentHookClient;
