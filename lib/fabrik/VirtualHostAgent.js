'use strict';

const Agent = require('./Agent');

class VirtualHostAgent extends Agent {

  constructor(settings) {
    super({
      json: true
    });
    this.settings = settings;
  }

  provision(ips, guid) {
    const body = {
      parameters: {}
    };
    return this
      .getHost(ips, 'multi-tenancy')
      .then(ip => this.post(ip, `tenants/${guid}/lifecycle/provision`, body, 200));
  }

  deprovision(ips, guid) {
    const body = {
      parameters: {}
    };
    return this
      .getHost(ips, 'multi-tenancy')
      .then(ip => this.post(ip, `tenants/${guid}/lifecycle/deprovision`, body, 200));
  }

  createCredentials(ips, guid, parameters) {
    const body = {
      parameters: parameters
    };
    return this
      .getHost(ips, 'credentials')
      .then(ip => this.post(ip, `tenants/${guid}/credentials/create`, body, 200));
  }

  deleteCredentials(ips, guid, credentials) {
    const body = {
      credentials: credentials
    };
    return this
      .getHost(ips, 'credentials')
      .then(ip => this.post(ip, `tenants/${guid}/credentials/delete`, body, 200));
  }
}
module.exports = VirtualHostAgent;