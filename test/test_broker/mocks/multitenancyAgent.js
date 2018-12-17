'use strict';

const nock = require('nock');
const credentials = {
  host: '10.244.10.160',
  port: '5432',
  Tenantname: '82a79953-31a3-47e6-8739-6ae2ad8cc074',
  username: '964e53adfd013b804eae0b7cc26e116c',
  password: 'd3e19fa48e2d16f803Tenant632f3584b172',
  uri: 'postgres://964e53adfd013b804eae0b7cc26e116c:d3e19fa48e2d16f803Tenant632f3584b172@10.11.12.229:5432/82a79953-31a3-47e6-8739-6ae2ad8cc074'
};
const agentIp = '10.244.10.160';
const agentUrl = `http://${agentIp}:2718`;

exports.ip = agentIp;
exports.url = agentUrl;
exports.credentials = credentials;
exports.createTenant = createTenant;
exports.updateTenant = updateTenant;
exports.deleteTenant = deleteTenant;
exports.createTenantCredentials = createTenantCredentials;
exports.deleteTenantCredentials = deleteTenantCredentials;


function createTenant(instanceId) {
  return nock(agentUrl)
    .replyContentLength()
    .post(`/v1/tenants/${instanceId}`)
    .reply(200, {});
}

function updateTenant(instanceId) {
  return nock(agentUrl)
    .replyContentLength()
    .put(`/v1/tenants/${instanceId}`)
    .reply(204, {});
}

function deleteTenant(instanceId) {
  return nock(agentUrl)
    .replyContentLength()
    .delete(`/v1/tenants/${instanceId}`)
    .reply(204, {});
}

function createTenantCredentials(instanceId) {
  return nock(agentUrl)
    .replyContentLength()
    .post(`/v1/tenants/${instanceId}/credentials`)
    .reply(200, credentials);
}

function deleteTenantCredentials(instanceId) {
  return nock(agentUrl)
    .delete(`/v1/tenants/${instanceId}/credentials`, {
      credentials: credentials
    })
    .reply(204, {});
}