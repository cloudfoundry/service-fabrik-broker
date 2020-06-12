'use strict';

const _ = require('lodash');
const Promise = require('bluebird');
const crypto = require('crypto');
const formatUrl = require('url').format;
const { CONST } = require('@sf/common-utils');

class DockerCredentials {
  constructor(options) {
    options = options || {};
    this.username = options.username || {};
    this.password = options.password || {};
    this.uri = options.uri || {};
    this.dbname = options.dbname || {};
  }

  randomString() {
    return this.constructor
      .randomBytes(12)
      .then(buffer => {
        const chars = buffer
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');
        const index = _.findIndex(chars, char => /^[a-z]$/i.test(char));
        return index > 0 ?
          chars[index] + chars.substring(0, index) + (chars.substring(index + 1) || '') :
          chars;
      });
  }

  get usernameKey() {
    return this.username.key;
  }

  get usernameValue() {
    return this.username.value ? this.username.value : this.randomString();
  }

  get passwordKey() {
    return this.password.key;
  }

  get passwordValue() {
    return this.password.value ? this.password.value : this.randomString();
  }

  get dbnameKey() {
    return this.dbname.key;
  }

  get dbnameValue() {
    return this.dbname.value ? this.dbname.value : this.randomString();
  }

  get uriPrefix() {
    return this.uri.prefix;
  }

  get uriPort() {
    return this.uri.port;
  }

  createEnvironment() {
    const environment = {};
    if (this.usernameKey) {
      environment[this.usernameKey] = this.usernameValue;
    }
    if (this.passwordKey) {
      environment[this.passwordKey] = this.passwordValue;
    }
    if (this.dbnameKey) {
      environment[this.dbnameKey] = this.dbnameValue;
    }
    return Promise.props(environment);
  }

  create(environment, hostname, ports) {
    const credentials = {
      hostname: hostname
    };
    const portValues = _.values(ports);
    if (portValues.length) {
      credentials.ports = ports;
    }
    if (this.uriPort) {
      credentials.port = _.get(ports, this.uriPort);
    } else if (portValues.length === 1) {
      credentials.port = _.first(portValues);
    }
    if (this.usernameKey) {
      credentials.username = _.get(environment, this.usernameKey);
    }
    if (this.passwordKey) {
      credentials.password = _.get(environment, this.passwordKey);
    }
    if (this.dbnameKey) {
      credentials.dbname = _.get(environment, this.dbnameKey);
    }
    if (this.uriPrefix) {
      const uri = {
        slashes: true,
        protocol: this.uriPrefix,
        hostname: credentials.hostname,
        auth: credentials.username || ''
      };
      if (credentials.password) {
        uri.auth += ':' + credentials.password;
      }
      if (credentials.port) {
        uri.port = credentials.port;
      }
      if (credentials.dbname) {
        uri.pathname = credentials.dbname;
      }
      credentials.uri = formatUrl(uri);
    }
    if (credentials.hostname && credentials.port) {
      credentials.end_points = [{
        network_id: CONST.NETWORK_MANAGER.NETWORK_ID,
        host: credentials.hostname,
        port: credentials.port
      }];
    }
    return credentials;
  }
}

DockerCredentials.randomBytes = Promise.promisify(crypto.randomBytes);

module.exports = DockerCredentials;
