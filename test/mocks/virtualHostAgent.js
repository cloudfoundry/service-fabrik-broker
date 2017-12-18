'use strict';

const nock = require('nock');
const credentials = {
  host: 'example.org:31415',
  uri: 'mongodb://5e91c9e75a0aec0a4d8e9c3523887576:12b6ca434be2dd8716d1009eb280e1c5@10.244.10.160:27017,10.11.252.21:27017,10.11.252.22:27017/8354aac89a3781b8?replicaSet=282477f09a2704e7e1ab1396f7721acc'
};

const agentIp = '10.244.10.160';
const agentUrl = `http://${agentIp}:2718`;

exports.ip = agentIp;
exports.url = agentUrl;
exports.credentials = credentials;
exports.createVirtualHost = createVirtualHost;
exports.deleteVirtualHost = deleteVirtualHost;
exports.createCredentials = createCredentials;
exports.deleteCredentials = deleteCredentials;

function createVirtualHost(instanceId) {
  return nock(agentUrl)
    .replyContentLength()
    .post(`/v1/tenants/${instanceId}`)
    .reply(200, {});
}

function deleteVirtualHost(instanceId) {
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