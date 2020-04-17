'use strict';
const { CONST } = require('@sf/common-utils');
const Agent = require('../../../data-access-layer/service-agent');

class MultitenancyAgent extends Agent {
  constructor(settings) {
    super(settings);
  }

  createTenant(ips, instanceId, params) {
    const body = {
      parameters: params
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.MULTI_TENANCY)
      .then(ip => this.post(ip, `tenants/${instanceId}`, body, CONST.HTTP_STATUS_CODE.OK));
  }

  deleteTenant(ips, instanceId) {
    const body = {
      parameters: {}
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.MULTI_TENANCY)
      .then(ip => this.delete(ip, `tenants/${instanceId}`, body, CONST.HTTP_STATUS_CODE.NO_CONTENT));
  }

  updateTenant(ips, instanceId, params) {
    const body = {
      parameters: params
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.MULTI_TENANCY)
      .then(ip => this.put(ip, `tenants/${instanceId}`, body, CONST.HTTP_STATUS_CODE.NO_CONTENT));
  }

  createTenantCredentials(ips, instanceId, parameters) {
    const body = {
      parameters: parameters
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.CREDENTIALS)
      .then(ip => this.post(ip, `tenants/${instanceId}/credentials`, body, CONST.HTTP_STATUS_CODE.OK));
  }

  deleteTenantCredentials(ips, instanceId, credentials) {
    const body = {
      credentials: credentials
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.CREDENTIALS)
      .then(ip => this.delete(ip, `tenants/${instanceId}/credentials`, body, CONST.HTTP_STATUS_CODE.NO_CONTENT));
  }

}
module.exports = MultitenancyAgent;
