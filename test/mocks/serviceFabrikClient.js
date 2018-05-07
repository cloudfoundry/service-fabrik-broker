'use strict';

const nock = require('nock');
const lib = require('../../broker/lib');
const CONST = require('../../broker/lib/constants');

const config = lib.config;
const serviceFabrikUrl = `${config.external.protocol}://${config.external.host}`;
const backupGuid = '071acb05-66a3-471b-af3c-8bbf1e4180be';

exports.startBackup = startBackup;
exports.deleteBackup = deleteBackup;
exports.scheduleBackup = scheduleBackup;
exports.scheduleUpdate = scheduleUpdate;

function startBackup(instance_id, payload, response) {
  return nock(serviceFabrikUrl)
    .replyContentLength()
    .post(`/api/v1/service_instances/${instance_id}/backup`, payload)
    .reply(response.status || 202, {
      name: 'backup',
      guid: response.backup_guid || backupGuid
    });
}

function scheduleBackup(instance_id, payload) {
  const time = Date.now();
  const repeatTimezone = 'America/New_York';
  const username = 'hugo';

  return nock(serviceFabrikUrl)
    .replyContentLength()
    .put(`/api/v1/service_instances/${instance_id}/schedule_backup`, payload)
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

function scheduleUpdate(instance_id, payload) {
  const time = Date.now();
  const repeatTimezone = 'America/New_York';
  const username = 'hugo';

  return nock(serviceFabrikUrl)
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

function scheduleUpdate(instance_id, payload) {
  const time = Date.now();
  const repeatTimezone = 'America/New_York';
  const username = 'hugo';

  return nock(serviceFabrikUrl)
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

function scheduleUpdate(instance_id, payload) {
  const time = Date.now();
  const repeatTimezone = 'America/New_York';
  const username = 'hugo';

  return nock(serviceFabrikUrl)
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

function scheduleUpdate(instance_id, payload) {
  const time = Date.now();
  const repeatTimezone = 'America/New_York';
  const username = 'hugo';

  return nock(serviceFabrikUrl)
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

function scheduleUpdate(instance_id, payload) {
  const time = Date.now();
  const repeatTimezone = 'America/New_York';
  const username = 'hugo';

  return nock(serviceFabrikUrl)
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

function deleteBackup(backup_guid, space_guid) {
  return nock(serviceFabrikUrl)
    .replyContentLength()
    .delete(`/api/v1/backups/${backup_guid}?space_guid=${space_guid}`)
    .reply(200, {});
}