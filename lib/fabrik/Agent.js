'use strict';

const _ = require('lodash');
const formatUrl = require('url').format;
const path = require('path');
const Promise = require('bluebird');
const utils = require('../utils');
const logger = require('../logger');
const errors = require('../errors');
const HttpClient = utils.HttpClient;
const compareVersions = utils.compareVersions;
const FeatureNotSupportedByAnyAgent = errors.FeatureNotSupportedByAnyAgent;

class Agent extends HttpClient {
  constructor(settings) {
    super({
      json: true
    });
    this.settings = settings;
  }

  get basePath() {
    return `/v${this.settings.version}`;
  }

  get auth() {
    return this.settings.auth;
  }

  get protocol() {
    return this.settings.protocol || 'http';
  }

  get hostname() {
    return this.settings.hostname;
  }

  get port() {
    return this.settings.port || 2718;
  }

  get features() {
    return this.settings.supported_features || [];
  }

  getUrl(host, pathname) {
    return formatUrl({
      protocol: this.protocol,
      hostname: host,
      port: this.port,
      pathname: path.posix.join(this.basePath, pathname)
    });
  }

  post(ip, pathname, body, expectedStatusCode) {
    return this
      .request({
        method: 'POST',
        url: this.getUrl(ip, pathname),
        auth: this.auth,
        body: body
      }, expectedStatusCode || 200)
      .then(res => res.body);
  }

  getInfo(ip) {
    return this
      .request({
        method: 'GET',
        url: this.getUrl(ip, 'info')
      }, 200)
      .then(res => {
        if (_.isPlainObject(res.body)) {
          return res.body;
        }
        throw new Error(`Received invalid '${this.basePath}/info' response`);
      });
  }

  getHost(ips, feature) {
    if (this.hostname) {
      return Promise.resolve(this.hostname);
    }
    return Promise
      .any(_.map(ips, ip => this
        .getInfo(ip)
        .then(info => {
          logger.debug(`checking ${feature} in ${ip} agent info - ${info}`);
          const api_version = _.get(info, 'api_version', '1.0');
          if (compareVersions(api_version, '1.1') < 0) {
            if (_.includes(['credentials'], feature)) {
              return ip;
            }
          } else if (compareVersions(api_version, '1.2') < 0) {
            if (_.includes(info.supported_features, feature)) {
              return ip;
            }
          }
          throw new Error(`Agent '${ip}' does not support feature '${feature}'`);
        })
      ))
      .catchThrow(new FeatureNotSupportedByAnyAgent(feature));
  }

  getState(ips) {
    return this
      .getHost(ips, 'state')
      .then(ip => this.request({
        method: 'GET',
        url: this.getUrl(ip, 'state'),
        auth: this.auth
      }, 200))
      .then(res => res.body);
  }

  deprovision(ips) {
    const body = {};
    return this
      .getHost(ips, 'lifecycle')
      .then(ip => this.post(ip, 'lifecycle/deprovision', body, 200));
  }

  createCredentials(ips, parameters) {
    const body = {
      parameters: parameters
    };
    return this
      .getHost(ips, 'credentials')
      .then(ip => this.post(ip, 'credentials/create', body, 200));
  }

  deleteCredentials(ips, credentials) {
    const body = {
      credentials: credentials
    };
    return this
      .getHost(ips, 'credentials')
      .then(ip => this.post(ip, 'credentials/delete', body, 200));
  }

  startBackup(ips, backup, vms) {
    const body = {
      backup: backup,
      vms: vms
    };
    return this
      .getHost(ips, 'backup')
      .tap(ip => this.post(ip, 'backup/start', body, 202));
  }

  abortBackup(ip) {
    const body = {};
    return this
      .post(ip, 'backup/abort', body, 202);
  }

  getBackupLastOperation(ip) {
    return this
      .request({
        method: 'GET',
        url: this.getUrl(ip, 'backup'),
        auth: this.auth
      }, 200)
      .then(res => res.body);
  }

  getBackupLogs(ip) {
    return this
      .request({
        method: 'GET',
        url: this.getUrl(ip, 'backup/logs'),
        auth: this.auth,
        json: false
      }, 200)
      .then(res => _
        .chain(res.body)
        .split('\n')
        .compact()
        .map(this.constructor.parseLogEntry)
        .value()
      );
  }

  startRestore(ips, backup, vms) {
    const body = {
      backup: backup,
      vms: vms
    };
    return this
      .getHost(ips, 'restore')
      .tap(ip => this.post(ip, 'restore/start', body, 202));
  }

  abortRestore(ip) {
    const body = {};
    return this
      .post(ip, 'restore/abort', body, 202);
  }

  getRestoreLastOperation(ip) {
    return this
      .request({
        method: 'GET',
        url: this.getUrl(ip, 'restore'),
        auth: this.auth
      }, 200)
      .then(res => res.body);
  }

  getRestoreLogs(ip) {
    return this
      .request({
        method: 'GET',
        url: this.getUrl(ip, 'restore/logs'),
        auth: this.auth,
        json: false
      }, 200)
      .then(res => _
        .chain(res.body)
        .split('\n')
        .compact()
        .map(this.constructor.parseLogEntry)
        .value()
      );
  }

  static parseLogEntry(entry) {
    try {
      return JSON.parse(entry);
    } catch (err) {
      return {
        error: err.message
      };
    }
  }
}

module.exports = Agent;