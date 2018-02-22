'use strict';

const nock = require('nock');
const credentials = {
  host: '10.244.10.160',
  port: '5672',
  virtual_host: 'vhost',
  username: 'vhost_username',
  password: 'vhost_password',
  uri: 'amqp://vhost_username:vhost_password@10.244.10.160:5672/vhost'
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