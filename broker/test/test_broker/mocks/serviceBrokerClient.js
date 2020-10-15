'use strict';

const _ = require('lodash');
const nock = require('nock');
const {
  CONST,
  commonFunctions: {
    encodeBase64
  }
} = require('@sf/common-utils');
const config = require('@sf/app-config');
const serviceBrokerUrl = `${config.internal.protocol}://${config.internal.host}`;
const serviceBrokerAdminUrl = `${config.admin_app.protocol}://${config.admin_app.host}`;
const backupGuid = '071acb05-66a3-471b-af3c-8bbf1e4180be';

exports.getDeploymentRestoreStatus = getDeploymentRestoreStatus;
exports.startDeploymentBackup = startDeploymentBackup;
exports.getDeploymentBackupStatus = getDeploymentBackupStatus;
exports.updateServiceInstance = updateServiceInstance;
exports.getConfigValue = getConfigValue;

function isoDate(time) {
  return new Date(time).toISOString().replace(/\.\d*/, '').replace(/:/g, '-');
}

function startDeploymentBackup(name, response, payload) {
  const token = encodeBase64({
    backup_guid: response.backup_guid || backupGuid,
    agent_ip: mocks.agent.ip,
    operation: 'backup'
  });
  return nock(serviceBrokerAdminUrl)
    .replyContentLength()
    .post(`/admin/deployments/${name}/backup`, _.matches(payload))
    .reply(response.status || 202, {
      operation: 'backup',
      backup_guid: response.backup_guid || backupGuid,
      token: token
    });
}

function getDeploymentBackupStatus(name, token, state, boshDirector, responseStatus) {
  const backupState = {
    state: state || 'processing',
    stage: 'Creating volume',
    updated_at: isoDate(Date.now())
  };
  let queryParams = {
    token: token
  };
  if (boshDirector) {
    queryParams = _.assign(queryParams, {
      bosh_director: boshDirector
    });
  }
  return nock(serviceBrokerAdminUrl)
    .replyContentLength()
    .get(`/admin/deployments/${name}/backup/status`)
    .query(queryParams)
    .reply(responseStatus || 200, backupState);
}

function getDeploymentRestoreStatus(name, token, state, responseStatus) {
  const restoreState = {
    state: state || 'processing',
    stage: 'Restore completed successfully',
    updated_at: isoDate(Date.now())
  };
  let queryParams = {
    token: token
  };
  return nock(serviceBrokerAdminUrl)
    .replyContentLength()
    .get(`/admin/deployments/${name}/restore/status`)
    .query(queryParams)
    .reply(responseStatus || 200, restoreState);
}

function updateServiceInstance(instace_id, payload, response) {
  return nock(serviceBrokerUrl, {
      reqheaders: {
        'X-Broker-API-Version': function (headerValue) {
          if (headerValue === CONST.SF_BROKER_API_VERSION_MIN) {
            return true;
          }
          return false;
        }
      }
    })
    .replyContentLength()
    .patch(`/cf/v2/service_instances/${instace_id}`, payload)
    .query({
      accepts_incomplete: true
    })
    .reply(response.status || 202, response.body || {});
}

function getConfigValue(responseStatus, key, disabled) {
  return nock(serviceBrokerAdminUrl)
    .replyContentLength()
    .get(`/admin/config/${key}`)
    .reply(responseStatus || 200, {
      value: disabled
    });
}