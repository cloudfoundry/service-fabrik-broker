'use strict';

const _ = require('lodash');

const logger = require('@sf/logger');
const config = require('@sf/app-config');

const {
  CONST,
  HttpClient
} = require('@sf/common-utils');

class ServiceBrokerClient extends HttpClient {
  constructor() {
    super({
      baseURL: `${config.internal.protocol}://${config.internal.host}`,
      auth: {
        username: config.username,
        password: config.password
      },
      headers: {
        Accept: 'application/json'
      },
      maxRedirects: 10,
      rejectUnauthorized: !config.skip_ssl_validation
    });
  }

  startDeploymentBackup(options) {
    logger.info(`-> Starting deployment backup -  name: ${options.deployment_name}`);
    const body = _.omit(options, 'deployment_name');
    return this
      .request({
        method: 'POST',
        baseURL: `${config.admin_app.protocol}://${config.admin_app.host}`,
        url: `/admin/deployments/${options.deployment_name}/backup`,
        auth: {
          username: config.username,
          password: config.password
        },
        data: body,
        headers: {
          'Content-type': 'application/json'
        },
        responseType: 'json'
      }, 202)
      .then(res => res.body);
  }

  getDeploymentBackupStatus(name, token, boshDirectorName, agentProperties) {
    return this
      .request({
        method: 'GET',
        baseURL: `${config.admin_app.protocol}://${config.admin_app.host}`,
        url: `/admin/deployments/${name}/backup/status`,
        auth: {
          username: config.username,
          password: config.password
        },
        params: {
          token: token,
          bosh_director: boshDirectorName
        },
        data: {
          agent_properties: agentProperties
        },
        headers: {
          'Content-type': 'application/json'
        },
        responseType: 'json'
      }, 200)
      .then(res => res.body);
  }
  getDeploymentRestoreStatus(name, token, boshDirectorName, agentProperties) {
    return this
      .request({
        method: 'GET',
        baseURL: `${config.admin_app.protocol}://${config.admin_app.host}`,
        url: `/admin/deployments/${name}/restore/status`,
        auth: {
          username: config.username,
          password: config.password
        },
        params: {
          token: token,
          bosh_director: boshDirectorName
        },
        data: {
          agent_properties: agentProperties
        },
        headers: {
          'Content-type': 'application/json'
        },
        responseType: 'json'
      }, 200)
      .then(res => res.body);
  }

  updateServiceInstance(options) {
    logger.info(`-> Updating instance -  name: ${options.instance_id}`);
    const body = _.omit(options, 'instance_id');
    return this
      .request({
        method: 'PATCH',
        url: `/cf/v2/service_instances/${options.instance_id}`,
        auth: {
          username: config.username,
          password: config.password
        },
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Broker-API-Version': CONST.SF_BROKER_API_VERSION_MIN
        },
        params: {
          accepts_incomplete: true
        },
        data: body,
        responseType: 'json'
      }, 202)
      .then(res => res.body);
  }

  getConfigValue(key) {
    logger.debug(`Getting the config value for key: ${key}`);
    return this
      .request({
        method: 'GET',
        baseURL: `${config.admin_app.protocol}://${config.admin_app.host}`,
        url: `/admin/config/${key}`,
        auth: {
          username: config.username,
          password: config.password
        },
        headers: {
          'Content-type': 'application/json'
        },
        responseType: 'json'
      }, 200)
      .then(res => res.body.value);
  }
}

module.exports = ServiceBrokerClient;
