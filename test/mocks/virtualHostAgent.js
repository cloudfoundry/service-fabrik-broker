'use strict';

const nock = require('nock');
const credentials = {
  host: '10.244.10.160',
  port: '5672',
  virtual_host: '5b91c9e75a0aec0a4d8e9c3523887577',
  username: '5e91c9e75a0aec0a4d8e9c3523887576',
  password: '12b6ca434be2dd8716d1009eb280e1c5',
  uri: 'amqp://5e91c9e75a0aec0a4d8e9c3523887576:12b6ca434be2dd8716d1009eb280e1c5@10.244.10.160:5672/5b91c9e75a0aec0a4d8e9c3523887577'
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