'use strict';

const nock = require('nock');
const credentials = {
  host: '10.244.10.160',
  port: '5432',
  dbname: '82a79953-31a3-47e6-8739-6ae2ad8cc074',
  username: '964e53adfd013b804eae0b7cc26e116c',
  password: 'd3e19fa48e2d16f803db632f3584b172',
  uri: 'postgres://964e53adfd013b804eae0b7cc26e116c:d3e19fa48e2d16f803db632f3584b172@10.11.12.229:5432/82a79953-31a3-47e6-8739-6ae2ad8cc074'
};
const agentIp = '10.244.10.160';
const agentUrl = `http://${agentIp}:2718`;

exports.ip = agentIp;
exports.url = agentUrl;
exports.credentials = credentials;
exports.createDb = createDb;
exports.updateDb = updateDb;
exports.deleteDb = deleteDb;
exports.createCredentials = createCredentials;
exports.deleteCredentials = deleteCredentials;

function createDb(instanceId) {
  return nock(agentUrl)
    .replyContentLength()
    .post(`/v1/tenants/${instanceId}`)
    .reply(200, {});
}

function updateDb(instanceId) {
  return nock(agentUrl)
    .replyContentLength()
    .put(`/v1/tenants/${instanceId}`)
    .reply(204, {});
}

function deleteDb(instanceId) {
  return nock(agentUrl)
    .replyContentLength()
    .delete(`/v1/tenants/${instanceId}`)
    .reply(204, {});
}

function createCredentials(instanceId) {
  return nock(agentUrl)
    .replyContentLength()
    .post(`/v1/tenants/${instanceId}/credentials`)
    .reply(200, credentials);
}

function deleteCredentials(instanceId) {
  return nock(agentUrl)
    .delete(`/v1/tenants/${instanceId}/credentials`, {
      credentials: credentials
    })
    .reply(204);
}