'use strict';

const _ = require('lodash');
const nock = require('nock');
const utils = require('../../../common/utils');

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
exports.getSnapshot = getSnapshot;
exports.createDisk = createDisk;
exports.getDisk = getDisk;
exports.config = config;

function encodePath(pathname) {
  return pathname.replace(/:/g, '%3A');
}

function auth(times) {
  const token = {
    type: 'update',
    parameters: {},
    task_id: 'service-fabrik-1790-46d34d39-83b1-4b2d-8260-50f2d66a0957_23598'
  };
  return nock('https://login.microsoftonline.com')
    .replyContentLength()
    .post(`/${provider.tenant_id}/oauth2/token?api-version=1.0`, body => _.isObject(body))
    .times(times || 1)
    .reply(200, '{\"token_type\":\"Bearer\",\"resource\":\"https://management.core.windows.net/\",\"access_token\":\"' + utils.encodeBase64(token) + '\"}', {
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
        'esctx=XXXXXXXXXX9XX2X27XXXXXXXXX0XXX4-XXXXXXXX-XXXXXXXXX0X7XXXX7XXX4XXXXXXXXXX0X-5XXXXXXXXXX2XXX9XX6X5XXXXXXXX8XXX1X0XXXXXX6XXXXXX3X7X5X3XXX8passwordXX1-XXXXXXXX6XXXXXX7X8XXXXXX5XX-XXXXX9XXXXXXXXXX; domain=.login.microsoftonline.com; path=/; secure; HttpOnly',
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

function deleteSnapshot(remote, expectedResponse, errorMessage) {
  if (errorMessage === undefined) {
    return nock('https://management.azure.com')
      .delete(remote)
      .reply(expectedResponse.status || 204, '', expectedResponse.headers);
  } else {
    return nock('https://management.azure.com')
      .delete(remote)
      .replyWithError(errorMessage);
  }
}

function getSnapshot(remote, expectedResponse, errorMessage) {
  if (errorMessage === undefined) {
    return nock('https://management.azure.com')
      .get(remote)
      .reply(expectedResponse.status || 200, expectedResponse.body, expectedResponse.headers);
  } else {
    return nock('https://management.azure.com')
      .get(remote)
      .replyWithError(errorMessage);
  }
}

function getDisk(remote, expectedResponse, errorMessage) {
  if (errorMessage === undefined) {
    return nock('https://management.azure.com')
      .get(remote)
      .reply(expectedResponse.status || 200, expectedResponse.body, expectedResponse.headers);
  } else {
    return nock('https://management.azure.com')
      .get(remote)
      .replyWithError(errorMessage);
  }
}

function createDisk(remote, requestBody, expectedResponse, errorMessage) {
  if (errorMessage === undefined) {
    return nock('https://management.azure.com')
      .replyContentLength()
      .put(remote, requestBody)
      .reply(expectedResponse.status || 200, expectedResponse.body, expectedResponse.headers);
  } else {
    return nock('https://management.azure.com')
      .put(remote, requestBody)
      .replyWithError(errorMessage);
  }
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