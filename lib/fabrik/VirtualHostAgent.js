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
const Agent = require('./Agent');

class VirtualHostAgent extends Agent{

    constructor(settings) {
        super({
          json: true
        });
        this.settings = settings;
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

    provision(ips, guid){
        const body = {
            parameters: {}
          };
          return this
            .getHost(ips, 'multi-tenancy')
            .then(ip => this.post(ip, `tenants/${guid}/lifecycle/provision`, body, 200));
    }

    deprovision(ips, guid){
        const body = {
            parameters: {}
          };
          return this
            .getHost(ips, 'multi-tenancy')
            .then(ip => this.post(ip, `tenants/${guid}/lifecycle/deprovision`, body, 200));
    }

    createCredentials(ips, guid, parameters){
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