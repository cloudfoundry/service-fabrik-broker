const _ = require('lodash');
const config = require('@sf/app-config');
const { AxiosHttpClient, errors: {
  InternalServerError
}, CONST } = require('@sf/common-utils');

class ServiceFabrikClient extends AxiosHttpClient {
  constructor(tokenIssuer) {
    super({
      baseURL: `${_.get(config, 'external.protocol')}://${_.get(config, 'external.host')}`,
      auth: {
        username: config.cf.username,
        password: config.cf.password
      },
      headers: {
        Accept: 'application/json'
      },
      maxRedirects: 10,
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
          auth: false, // Disable basic auth
          headers: { // and use bearer
            authorization: `Bearer ${accessToken}`,
            'Content-type': 'application/json'
          },
          responseType: 'json'
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
          auth: false,
          headers: {
            authorization: `Bearer ${accessToken}`,
            'Content-type': 'application/json'
          },
          responseType: 'json',
          data: body
        }, 202))
      .then(res => res.body);
  }

  abortLastBackup(options) {
    return this.tokenIssuer
      .getAccessToken()
      .then(accessToken => this
        .request({
          method: 'DELETE',
          url: `/api/v1/service_instances/${options.instance_guid}/backup?space_guid=${options.tenant_id}`,
          auth: false,
          headers: {
            authorization: `Bearer ${accessToken}`,
            'Content-type': 'application/json'
          },
          responseType: 'json'
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
          url: `/api/v1/backups/${options.backup_guid}?space_guid=${options.tenant_id}&instance_deleted=${options.instance_deleted}`,
          auth: false,
          headers: {
            authorization: `Bearer ${accessToken}`,
            'Content-type': 'application/json'
          },
          responseType: 'json'
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
          auth: false,
          headers: {
            authorization: `Bearer ${accessToken}`,
            'Content-type': 'application/json'
          },
          responseType: 'json',
          data: body
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
          auth: false,
          headers: {
            authorization: `Bearer ${accessToken}`,
            'Content-type': 'application/json'
          },
          responseType: 'json',
          data: body
        }, 201)
        .then(res => res.body)
      );
  }
}

module.exports = ServiceFabrikClient;
