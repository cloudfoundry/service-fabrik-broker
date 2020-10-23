'use strict';

const nock = require('nock');
const {
  CONST
} = require('@sf/common-utils');

const config = require('@sf/app-config');
const serviceFabrikUrl = `${config.external.protocol}://${config.external.host}`;
const backupGuid = '071acb05-66a3-471b-af3c-8bbf1e4180be';

exports.startBackup = startBackup;
exports.deleteBackup = deleteBackup;
exports.scheduleBackup = scheduleBackup;
exports.scheduleUpdate = scheduleUpdate;
exports.getBackupState = getBackupState;

function startBackup(instance_id, payload, response) {
  return nock(serviceFabrikUrl, {
    reqheaders: {
      authorization: /^bearer/i
    }
  })
    .replyContentLength()
    .post(`/api/v1/service_instances/${instance_id}/backup`, payload)
    .reply(response.status || 202, {
      name: 'backup',
      guid: response.backup_guid || backupGuid
    });
}

function getBackupState(instance_id, response, query) {
  return nock(serviceFabrikUrl)
    .replyContentLength()
    .get(`/api/v1/service_instances/${instance_id}/backup/status`)
    .query(query || true)
    .reply(response.status, response.body || {});
}

function scheduleBackup(instance_id, payload) {
  const time = Date.now();
  const repeatTimezone = 'America/New_York';
  const username = 'hugo';

  return nock(serviceFabrikUrl, {
    reqheaders: {
      authorization: /^bearer/i
    }
  })
    .replyContentLength()
    .put(`/api/v1/service_instances/${instance_id}/schedule_backup`, payload)
    .reply(201, {
      name: `${instance_id}_${CONST.JOB.SCHEDULED_BACKUP}`,
      repeatInterval: '54 8 * * *',
      data: {
        instance_id: instance_id,
        type: 'online'
      },
      nextRunAt: time,
      lastRunAt: time,
      lockedAt: null,
      repeatTimezone: repeatTimezone,
      createdAt: time,
      updatedAt: time,
      createdBy: username,
      updatedBy: username
    });
}

function scheduleUpdate(instance_id, payload) {
  const time = Date.now();
  const repeatTimezone = 'America/New_York';
  const username = 'hugo';

  return nock(serviceFabrikUrl, {
    reqheaders: {
      authorization: /^bearer/i
    }
  })
    .replyContentLength()
    .put(`/api/v1/service_instances/${instance_id}/schedule_update`, payload)
    .reply(201, {
      name: `${instance_id}_${CONST.JOB.SCHEDULED_BACKUP}`,
      repeatInterval: payload.repeatInterval,
      data: {
        instance_id: instance_id,
        type: 'online'
      },
      nextRunAt: time,
      lastRunAt: time,
      lockedAt: null,
      repeatTimezone: repeatTimezone,
      createdAt: time,
      updatedAt: time,
      createdBy: username,
      updatedBy: username
    });
}

function deleteBackup(backup_guid, space_guid, instance_deleted) {
  return nock(serviceFabrikUrl, {
    reqheaders: {
      authorization: /^bearer/i
    }
  })
    .replyContentLength()
    .delete(`/api/v1/backups/${backup_guid}?space_guid=${space_guid}&instance_deleted=${instance_deleted}`)
    .reply(200, {});
}