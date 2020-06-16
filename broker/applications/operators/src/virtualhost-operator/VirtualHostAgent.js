'use strict';
const { CONST } = require('@sf/common-utils');
const Agent = require('@sf/service-agent');

class VirtualHostAgent extends Agent {
  constructor(settings) {
    super(settings);
  }

  createVirtualHost(ips, instanceId, params) {
    const body = {
      parameters: params
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.MULTI_TENANCY)
      .then(ip => this.post(ip, `tenants/${instanceId}`, body, 200));
  }

  updateVirtualHost(ips, instanceId, params) {
    const body = {
      parameters: params
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.MULTI_TENANCY)
      .then(ip => this.put(ip, `tenants/${instanceId}`, body, 204));
  }

  deleteVirtualHost(ips, instanceId) {
    const body = {
      parameters: {}
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.MULTI_TENANCY)
      .then(ip => this.delete(ip, `tenants/${instanceId}`, body, 204));
  }

  createCredentials(ips, instanceId, parameters) {
    const body = {
      parameters: parameters
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.CREDENTIALS)
      .then(ip => this.post(ip, `tenants/${instanceId}/credentials`, body, 200));
  }

  deleteCredentials(ips, instanceId, credentials) {
    const body = {
      credentials: credentials
    };
    return this
      .getHost(ips, CONST.AGENT.FEATURE.CREDENTIALS)
      .then(ip => this.delete(ip, `tenants/${instanceId}/credentials`, body, 204));
  }
}
module.exports = VirtualHostAgent;
