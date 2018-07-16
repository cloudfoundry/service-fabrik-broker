'use strict';

const _ = require('lodash');
const config = require('../../../common/config');
const HttpClient = require('../../../common/utils').HttpClient;
const logger = require('../../../common/logger');

class ServiceBrokerClient extends HttpClient {
  constructor() {
    super({
      baseUrl: `${config.internal.protocol}://${config.internal.host}`,
      auth: {
        user: config.username,
        pass: config.password
      },
      headers: {
        Accept: 'application/json'
      },
      followRedirect: true,
      rejectUnauthorized: !config.skip_ssl_validation
    });
  }

  startDeploymentBackup(options) {
    logger.info(`-> Starting deployment backup -  name: ${options.deployment_name}`);
    const body = _.omit(options, 'deployment_name');
    return this
      .request({
        method: 'POST',
        url: `/admin/deployments/${options.deployment_name}/backup`,
        auth: {
          user: config.username,
          pass: config.password
        },
        body: body,
        json: true
      }, 202)
      .then(res => res.body);
  }

  getDeploymentBackupStatus(name, token, boshDirectorName) {
    return this
      .request({
        method: 'GET',
        url: `/admin/deployments/${name}/backup/status`,
        auth: {
          user: config.username,
          pass: config.password
        },
        qs: {
          token: token,
          bosh_director: boshDirectorName
        },
        json: true
      }, 200)
      .then(res => res.body);
  }
  getDeploymentRestoreStatus(name, token, boshDirectorName) {
    return this
      .request({
        method: 'GET',
        url: `/admin/deployments/${name}/restore/status`,
        auth: {
          user: config.username,
          pass: config.password
        },
        qs: {
          token: token,
          bosh_director: boshDirectorName
        },
        json: true
      }, 200)
      .then(res => res.body);
  }
}

module.exports = new ServiceBrokerClient();