'use strict';
const CONST = require('../../common/constants');
const Agent = require('../../data-access-layer/service-agent');
const logger = require('../../common/logger');

class PostgresqlAgent extends Agent {
  constructor(settings) {
    super(settings);
  }

  createDb(ips, instanceId, params) {
    const body = {
      parameters: params
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.MULTI_TENANCY)
      .tap(ip => logger.debug(`Ip to handle logicaldb creation request, ${ip}`))
      .then(ip => this.post(ip, `tenants/${instanceId}`, body, 200));
  }

  deleteDb(ips, instanceId) {
    const body = {
      parameters: {}
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.MULTI_TENANCY)
      .tap(ip => logger.debug(`Ip to handle logicaldb deletion request, ${ip}`))
      .then(ip => this.delete(ip, `tenants/${instanceId}`, body, 204));
  }

  updateDb(ips, instanceId, params) {
    const body = {
      parameters: params
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.MULTI_TENANCY)
      .tap(ip => logger.debug(`Ip to handle logicaldb update request, ${ip}`))
      .then(ip => this.put(ip, `tenants/${instanceId}`, body, 204));
  }

  createCredentials(ips, instanceId, parameters) {
    const body = {
      parameters: parameters
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.CREDENTIALS)
      .tap(ip => logger.debug(`Ip to handle logicaldb create credentials request, ${ip}`))
      .then(ip => this.post(ip, `tenants/${instanceId}/credentials`, body, 200));
  }

  deleteCredentials(ips, instanceId, credentials) {
    const body = {
      credentials: credentials
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.CREDENTIALS)
      .tap(ip => logger.debug(`Ip to handle logicaldb delete credentials request, ${ip}`))
      .then(ip => this.delete(ip, `tenants/${instanceId}/credentials`, body, 204));
  }

}
module.exports = PostgresqlAgent;