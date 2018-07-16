const _ = require('lodash');
const config = require('../../../common/config');
const utils = require('../utils');
const HttpClient = utils.HttpClient;
const errors = require('../../../common/errors');
const CONST = require('../../../common/constants');
const InternalServerError = errors.InternalServerError;

class ServiceFabrikClient extends HttpClient {
  constructor(tokenIssuer) {
    super({
      baseUrl: `${config.external.protocol}://${config.external.host}`,
      auth: {
        user: config.cf.username,
        pass: config.cf.password
      },
      headers: {
        Accept: 'application/json'
      },
      followRedirect: true,
      rejectUnauthorized: !config.skip_ssl_validation
    });
    this.tokenIssuer = tokenIssuer;
  }

  getInfo() {
    return this.tokenIssuer
      .getAccessToken()
      .then(accessToken => this
        .request({
          method: 'GET',
          url: '/api/v1/info',
          auth: {
            bearer: accessToken
          },
          json: true
        }, CONST.HTTP_STATUS_CODE.OK)
        .then(res => res.body)
      );
  }

  startBackup(options) {
    const body = _.omit(options, 'instance_id');
    return this.tokenIssuer
      .getAccessToken()
      .then(accessToken => this
        .request({
          method: 'POST',
          url: `/api/v1/service_instances/${options.instance_id}/backup`,
          auth: {
            bearer: accessToken
          },
          json: true,
          body: body
        }, 202)
        .then(res => res.body)
      );
  }

  abortLastBackup(options) {
    return this.tokenIssuer
      .getAccessToken()
      .then(accessToken => this
        .request({
          method: 'DELETE',
          url: `/api/v1/service_instances/${options.instance_guid}/backup?space_guid=${options.tenant_id}`,
          auth: {
            bearer: accessToken
          },
          json: true
        })
        .then(res => {
          if (res.statusCode === 200 || res.statusCode === 202) {
            return res.body;
          }
          throw new InternalServerError(`Error occurred while aborting backup. Status Code: ${res.statusCode} - Message: ${res.statusMessage}`);
        })
      );
  }

  deleteBackup(options) {
    return this.tokenIssuer
      .getAccessToken()
      .then(accessToken => this
        .request({
          method: 'DELETE',
          url: `/api/v1/backups/${options.backup_guid}?space_guid=${options.tenant_id}`,
          auth: {
            bearer: accessToken
          },
          json: true
        }, 200)
        .then(res => res.body)
      );
  }

  scheduleBackup(options) {
    const body = _.omit(options, 'instance_id');
    return this.tokenIssuer
      .getAccessToken()
      .then(accessToken => this
        .request({
          method: 'PUT',
          url: `/api/v1/service_instances/${options.instance_id}/schedule_backup`,
          auth: {
            bearer: accessToken
          },
          json: true,
          body: body
        }, 201)
        .then(res => res.body)
      );
  }

  scheduleUpdate(options) {
    const body = _.omit(options, 'instance_id');
    return this.tokenIssuer
      .getAccessToken()
      .then(accessToken => this
        .request({
          method: 'PUT',
          url: `/api/v1/service_instances/${options.instance_id}/schedule_update`,
          auth: {
            bearer: accessToken
          },
          json: true,
          body: body
        }, 201)
        .then(res => res.body)
      );
  }
}

module.exports = ServiceFabrikClient;