'use strict';

const _ = require('lodash');
const nock = require('nock');
const config = {
  backup: {
    retention_period_in_days: 14,
    max_num_on_demand_backup: 2,
    status_check_every: 120000, // (ms) Check the status of backup once every 2 mins
    backup_restore_status_poller_timeout: 86400000, // (ms) Deployment backup/restore must finish within this timeout time (24 hrs)
    backup_restore_status_check_every: 120000, // (ms) Check the status of deployment backup/restore once every 2 mins
    abort_time_out: 300000, //(ms) Timeout time for abort of backup to complete
    provider: {
      name: 'azure',
      subscription_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      resource_group: 'rg-abc',
      client_id: 'ccccccccc-cccc-cccc-cccc-cccccccccccc',
      client_secret: 'abc4356=',
      tenant_id: 'tttttttt-tttt-tttt-tttt-tttttttttttt',
      storageAccount: 'storageacc',
      storageAccessKey: 'YWJjMTIzIT8kKiYoKSctPUB+',
      container: 'samplecontainer'
    }
  }
};
const provider = config.backup.provider;
const objectStoreUrl = `https://${provider.storageAccount}.blob.core.windows.net`;

exports.auth = auth;
exports.download = download;
exports.upload = upload;
exports.headObject = headObject;
exports.getContainer = getContainer;
exports.list = list;
exports.remove = remove;
exports.deleteSnapshot = deleteSnapshot;
exports.config = config;

function encodePath(pathname) {
  return pathname.replace(/:/g, '%3A');
}

function auth() {
  return nock('https://login.microsoftonline.com')
    .replyContentLength()
    .post(`/${provider.tenant_id}/oauth2/token?api-version=1.0`, body => _.isObject(body))
    .reply(200, '{\"token_type\":\"Bearer\",\"resource\":\"https://management.core.windows.net/\",\"access_token\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6Ik1uQ19WWmNBVGZNNXBPWWlKSE1iYTlnb0VLWSIsImtpZCI6Ik1uQ19WWmNBVGZNNXBPWWlKSE1iYTlnb0VLWSJ9.eyJhdWQiOiJodHRwczovL21hbmFnZW1lbnQuY29yZS53aW5kb3dzLm5ldC8iLCJpc3MiOiJodHRwczovL3N0cy53aW5kb3dzLm5ldC83MmY5ODhiZi04NmYxLTQxYWYtOTFhYi0yZDdjZDAxMWRiNDcvIiwiaWF0IjoxNDYyNTUzMjY5LCJuYmYiOjE0NjI1NTMyNjksImV4cCI6MTQ2MjU1NzE2OSwiYXBwaWQiOiJiOWU2ZTA3Yi1jNDNlLTQ3MzEtODVjYS05ODE3ODkyNzI0Y2QiLCJhcHBpZGFjciI6IjEiLCJpZHAiOiJodHRwczovL3N0cy53aW5kb3dzLm5ldC83MmY5ODhiZi04NmYxLTQxYWYtOTFhYi0yZDdjZDAxMWRiNDcvIiwib2lkIjoiNGUwNDNmODYtYjMzZC00YzNiLThjNTYtNWM3NTkyOGEzNzBlIiwic3ViIjoiNGUwNDNmODYtYjMzZC00YzNiLThjNTYtNWM3NTkyOGEzNzBlIiwidGlkIjoiNzJmOTg4YmYtODZmMS00MWFmLTkxYWItMmQ3Y2QwMTFkYjQ3IiwidmVyIjoiMS4wIn0.rROtJoq7sd0BIfLtS-Ra9-xIN9lQPXnN0NvR8BWgEP8imEp1M3ryN8v1IUldiQeb6yhsf0Jg1QqA_vI8HUvCpDoCA7MvmSrMCVfrY7hKFDl9cJeFMILVXjWRbCHp29k0A_pz1r8au07_MmGGrEpBpc0Z5P1rr9qwOe4SmLCuC1poyNuERpwMtHXS4MwJ7mjz9OHsn_pvVxV9TMA-lcBxqfsxWPf8kbmHiFeyLonBftD-h0X7wjwJ-EGK6WSQ-bBtWyJNyJ6sDxqSUB4WpuywVVe_pCPcnKLhqD5tbW_thkyQG7nJ4bM_qqXvKIEtgxO0HGDIA7KS5AdMgBx8uNAC7g\"}', {
      'cache-control': 'no-cache, no-store',
      pragma: 'no-cache',
      'content-type': 'application/json; charset=utf-8',
      expires: '-1',
      server: 'Microsoft-IIS/8.5',
      'x-ms-request-id': '18339e6e-a37c-436a-ba80-bdb85739d9dd',
      'client-request-id': `${provider.client_id}`,
      'x-ms-gateway-service-instanceid': 'ESTSFE_IN_450',
      'x-content-type-options': 'nosniff',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      p3p: 'CP="DSP CUR OTPi IND OTRi ONL FIN"',
      'set-cookie': ['flight-uxoptin=true; path=/; secure; HttpOnly',
        'esctx=AAABAAAAiL9Kn2Z27UubvWFPbm0gLY4-QrqiDgIz-sINlFJRDZ0O7CIVv7bQh4gFoVbsaXSs0r-5GztukLogUf2sAb9wT6h5SUOGBdHR8xuG1x0McpdIN6sEiyFu3A7y5h3qXk8STZhFpvCkUWhiOFtvGbebH1-MPESKUGn6BEfkVi7O8nkXgvT5ey-gEQHD9TsrLGtjIAA; domain=.login.microsoftonline.com; path=/; secure; HttpOnly',
        'x-ms-gateway-slice=productiona; path=/; secure; HttpOnly',
        'stsservicecookie=ests; path=/; secure; HttpOnly'
      ],
      'x-powered-by': 'ASP.NET',
      date: 'Fri, 06 May 2016 16:52:49 GMT',
      connection: 'close',
      'content-length': '1234'
    });
}

function download(remote, body, headers) {
  let status = 200;
  if (body instanceof Error && body.status) {
    const err = _.pick(body, 'status', 'message');
    status = err.status;
    body = '';
  } else if (_.isPlainObject(body)) {
    body = JSON.stringify(body);
  }
  return nock(objectStoreUrl)
    .replyContentLength()
    .get(encodePath(remote))
    .reply(status, body, headers);
}

function upload(remote, expectedResponse, times) {
  return nock(objectStoreUrl)
    .filteringRequestBody(function (path) {
      return path === path;
    })
    .replyContentLength()
    .put(remote, true)
    .query(true)
    .times(times || 1)
    .reply(expectedResponse.status || 201, '', expectedResponse.headers);
}

function headObject(remote, status, headers) {
  return nock(objectStoreUrl)
    .replyContentLength()
    .head(encodePath(remote))
    .reply(status || 200, '', headers || undefined);
}

function remove(remote, expectedResponse) {
  return nock(objectStoreUrl)
    .delete(encodePath(remote))
    .reply(expectedResponse.status || 202, '', expectedResponse.headers);
}

function deleteSnapshot(remote, expectedResponse) {
  return nock('https://management.azure.com')
    .delete(remote)
    .reply(expectedResponse.status || 204, '', expectedResponse.headers);
}

function getContainer(remote, headers) {
  return nock(objectStoreUrl)
    .replyContentLength()
    .head(encodePath(remote))
    .reply(200, null, headers);
}

function list(containerName, prefix, expectedResponse) {
  const qs = {
    restype: 'container',
    comp: 'list'
  };
  if (prefix) {
    qs.prefix = prefix;
  }
  return nock(objectStoreUrl)
    .replyContentLength()
    .get(`/${containerName}`)
    .query(qs)
    .reply(expectedResponse.status || 200,
      expectedResponse.body,
      expectedResponse.headers);
}