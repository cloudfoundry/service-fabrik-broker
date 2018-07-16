'use strict';

const _ = require('lodash');
const formatUrl = require('url').format;
const path = require('path');
const Promise = require('bluebird');
const utils = require('../../../common/utils');
const logger = require('../../../common/logger');
const errors = require('../../../common/errors');
const HttpClient = utils.HttpClient;
const compareVersions = utils.compareVersions;
const FeatureNotSupportedByAnyAgent = errors.FeatureNotSupportedByAnyAgent;
var AGENT_CACHE = {};
class Agent extends HttpClient {
  constructor(settings) {
    super({
      json: true
    });
    this.settings = settings;
  }

  basePath(host) {
    const urls = [];
    urls.push(formatUrl({
      protocol: this.protocol,
      hostname: host,
      port: this.port,
      pathname: path.posix.join(`/v1`, 'info')
    }));
    urls.push(formatUrl({
      protocol: this.protocol,
      hostname: host,
      port: this.port,
      pathname: 'info'
    }));
    return Promise
      .any(_.map(urls, url => AGENT_CACHE[host] !== undefined ?
        Promise.resolve(`/v${AGENT_CACHE[host].api_version}`) :
        this.getApiVersion(url, host)
      ));
  }

  getApiVersion(url, host) {
    return this
      .request({
        method: 'GET',
        url: url
      }, 200)
      .then(res => {
        if (_.isPlainObject(res.body)) {
          return res.body;
        }
        throw new Error('Received invalid /info response', res);
      })
      .then(info => {
        logger.debug(`${host} agent info - `, info);
        let api_version = '1';
        if (info && info.api_version &&
          !Number.isInteger(info.api_version) &&
          compareVersions(info.api_version, '1.3') < 0) {
          info = _.set(info, 'api_version', `${api_version}`);
        }
        AGENT_CACHE[host] = info;
        return `/v${info.api_version}`;
      });
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
    return this.basePath(host)
      .then(basePath => {
        return formatUrl({
          protocol: this.protocol,
          hostname: host,
          port: this.port,
          pathname: path.posix.join(basePath, pathname)
        });
      });
  }

  post(ip, pathname, body, expectedStatusCode, authObject) {
    return this
      .getUrl(ip, pathname)
      .then(url => this
        .request({
          method: 'POST',
          url: url,
          auth: (authObject ? authObject : this.auth),
          body: body
        }, expectedStatusCode || 200)
        .then(res => res.body));
  }

  delete(ip, pathname, body, expectedStatusCode) {
    return this
      .getUrl(ip, pathname)
      .then(url => this.request({
        method: 'DELETE',
        url: url,
        auth: this.auth,
        body: body
      }, expectedStatusCode || 204))
      .return();
  }

  getInfo(ip) {
    return this
      .getUrl(ip, 'info')
      .then(url => this
        .request({
          method: 'GET',
          url: url
        }, 200))
      .then(res => {
        if (_.isPlainObject(res.body)) {
          return res.body;
        }
        throw new Error('Received invalid /info response', res);
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
          logger.debug(`checking ${feature} in ${ip} agent info`, info);
          const api_version = _.get(info, 'api_version', '1');
          if (compareVersions(api_version, '1.3') < 0 || Number.isInteger(Number(`${api_version}`))) {
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
      .then(ip => this.getUrl(ip, 'state'))
      .then(url => this.request({
        method: 'GET',
        url: url,
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

  preUpdate(ips, context) {
    const agentCredsBeforeUpdate = utils.getBrokerAgentCredsFromManifest(context.params.previous_manifest);
    // Making agent request with agent credentials from previous manifest
    // In case agent passwords are being updated as part of this update
    return this
      .getHost(ips, 'lifecycle.preupdate')
      .then(ip => this.post(ip, 'lifecycle/preupdate', context, 200, agentCredsBeforeUpdate));
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

  startBackup(ip, backup, vms) {
    const body = {
      backup: backup,
      vms: vms
    };
    return this
      .post(ip, 'backup/start', body, 202);
  }

  abortBackup(ip) {
    const body = {};
    return this
      .post(ip, 'backup/abort', body, 202);
  }

  getBackupLastOperation(ip) {
    return this
      .getUrl(ip, 'backup')
      .then(url => this
        .request({
          method: 'GET',
          url: url,
          auth: this.auth
        }, 200))
      .then(res => res.body);
  }

  getBackupLogs(ip) {
    return this
      .getUrl(ip, 'backup/logs')
      .then(url => this
        .request({
          method: 'GET',
          url: url,
          auth: this.auth,
          json: false
        }, 200))
      .then(res => _
        .chain(res.body)
        .split('\n')
        .compact()
        .map(this.constructor.parseLogEntry)
        .value());
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
      .getUrl(ip, 'restore')
      .then(url => this.request({
        method: 'GET',
        url: url,
        auth: this.auth
      }, 200))
      .then(res => res.body);
  }

  getRestoreLogs(ip) {
    return this
      .getUrl(ip, 'restore/logs')
      .then(url => this
        .request({
          method: 'GET',
          url: url,
          auth: this.auth,
          json: false
        }, 200))
      .then(res => _
        .chain(res.body)
        .split('\n')
        .compact()
        .map(this.constructor.parseLogEntry)
        .value());
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